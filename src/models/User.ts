import { Document, Schema, Model, model, Types } from 'mongoose';
import { IAlbumTagDocument } from './AlbumTag';
import { TagsByAlbum } from './public/GetMyAlbums';
import { BadRequestErrorResponse } from './public/GenericResponses';
import { ITagDocument } from './Tag';
import logger from '../util/logger';
import { encrypt, decrypt } from '../config/encrypto';
import { UserProfileAuthenticationNodeResponse } from 'spotify-web-api-node-typings';
import { IUser } from './interfaces/IUser';
import { TagDescriptor } from './public/GetMyTags';

export interface IUserDocument extends IUser, Document {

  /**
   * Access token is encrypted on save, but it's not decrypted after load (I can't make it work)
   */
  getDecryptedAccessToken(): string;
  /**
   * Refresh token is encrypted on save, but it's not decrypted after load (I can't make it work)
   */
  getDecryptedRefreshToken(): string;

  /**
   * Pushes the input album tag in this user's albumTags list
   * @param albumTag AlbumTag to add
   */
  addAlbumTag(albumTag: IAlbumTagDocument): Promise<boolean>;
  /**
   * Pulls the input album tag from this user's albumTags list
   * @param albumTag AlbumTag to remove
   */
  removeAlbumTag(albumTag: IAlbumTagDocument): Promise<IUserDocument>;
  /**
   * Starting from this user's albumTag list, builds a map of all
   * this user's tags grouped by spotify album id
   */
  getTagsGroupedByAlbum(): Promise<TagsByAlbum>;
  /**
   * Retrieves the list of the tags added by this user
   */
  getTags(): Promise<TagDescriptor[]>;

  /**
   * Retrieves the list of tags related to input album
   */
  getTagsByAlbum(spotifyAlbumId: string): Promise<ITagDocument[]>;

  /**
   * Adds the input album in current user's listening list
   */
  addToListeningList(spotifyAlbumId: string): Promise<IUserDocument>;

  /**
   * Remove input album from current user's listening list
   */
  removeFromListeningList(spotifyAlbumId: string): Promise<IUserDocument>;

  /**
   * This updates the new refreshed access token
   *
   * @param spotifyAccessToken New spotify access token
   */
  updateSpotifyAccessToken(spotifyAccessToken: string): Promise<IUserDocument>;
}

export interface IUserModel extends Model<IUserDocument> {
  /**
   * Creates a new user, if missing, or updates found user with the new tokens.
   * The user is searched by spotify id.
   * @param profile Spotify profile to insert
   * @param accessToken User's access token
   * @param refreshToken User's refresh token
   */
  upsertSpotifyUser(profile: UserProfileAuthenticationNodeResponse, accessToken: string, refreshToken: string): Promise<IUserDocument>;
}

export const userSchema: Schema = new Schema({
  spotify: {
    id: String,
    accessToken: String,
    refreshToken: String,
  },
  displayName: String,
  albumTags: [{ type: Schema.Types.ObjectId, ref: 'AlbumTag' }],
  listeningList: [{ type: String }],
}, { timestamps: true });

userSchema.pre('save', function (next) {
  const user = <IUserDocument>this;

  // I encrypt tokens and save them
  if (user.isModified('spotify.accessToken')) {
    const encrypted = encrypt(user.spotify.accessToken);
    user.spotify.accessToken = encrypted;
  }

  if (user.isModified('spotify.refreshToken')) {
    const encrypted = encrypt(user.spotify.refreshToken);
    user.spotify.refreshToken = encrypted;
  }

  return next();
});

// TODO: decrypt after load (it's not working)
// userSchema.post("init", function (doc, next) {
//   // This updates correctly the document, but returns the old values
//   const user = <IUser>this;
//   user.spotify.accessToken = decrypt(user.spotify.accessToken);
//   user.spotify.refreshToken = decrypt(user.spotify.refreshToken);
//   return user;
// });

userSchema.methods.getDecryptedAccessToken = function (): string {
  const thisUser = <IUserDocument>this;
  return decrypt(thisUser.spotify.accessToken);
};

userSchema.methods.getDecryptedRefreshToken = function (): string {
  const thisUser = <IUserDocument>this;
  return decrypt(thisUser.spotify.refreshToken);
};

userSchema.methods.addAlbumTag = async function (albumTag: IAlbumTagDocument): Promise<IUserDocument> {
  try {
    const thisUser = <IUserDocument>this;

    const countBeforeAdd = thisUser.albumTags.length;
    const added = (<Types.Array<IAlbumTagDocument>>thisUser.albumTags).addToSet(albumTag._id);
    const countAfterAdd = thisUser.albumTags.length;

    if (countAfterAdd === countBeforeAdd) {
      throw new BadRequestErrorResponse('Input tag already is one of the current user\'s tags');
    }

    const savedUser = await thisUser.save();
    return Promise.resolve(savedUser);
  } catch (error) {
    logger.error(error);
    return Promise.reject(error);
  }
};

userSchema.methods.removeAlbumTag = async function (albumTag: IAlbumTagDocument): Promise<IUserDocument> {
  try {
    const user = <IUserDocument>this;

    const countBeforePull = user.albumTags.length;
    const pulledId = (<Types.Array<IAlbumTagDocument>>user.albumTags).pull(albumTag._id);
    const countAfterPull = user.albumTags.length;

    if (countBeforePull === countAfterPull) {
      throw new BadRequestErrorResponse('Input tag is not one of the current user\'s tags');
    }

    const savedUser = await user.save();
    logger.debug(`AlbumTag deleted from user`);
    return Promise.resolve(savedUser);
  } catch (error) {
    logger.error(error);
    return Promise.reject(error);
  }
};

userSchema.methods.getTagsGroupedByAlbum = async function (): Promise<TagsByAlbum> {
  try {
    const thisUser = <IUserDocument>this;
    await thisUser
      .populate({
        path: 'albumTags',
        populate: [{ path: 'tag', select: 'uniqueId name' }, { path: 'album' }],
      })
      .execPopulate();

    // Grouping albums by spotifyId
    const taggedAlbums: TagsByAlbum = thisUser.albumTags.reduce((taggedAlbumsMap, albumTag) => {

      const spotifyId = albumTag.album.publicId.spotify;

      if (!taggedAlbumsMap[spotifyId]) {
        taggedAlbumsMap[spotifyId] = {
          album: albumTag.album,
          tags: []
        };
      }

      taggedAlbumsMap[spotifyId].tags.push(albumTag.tag);
      return taggedAlbumsMap;
    }, new TagsByAlbum());

    return taggedAlbums;

  } catch (error) {
    return Promise.reject(error);
  }
};

userSchema.methods.getTags = async function (): Promise<TagDescriptor[]> {
  try {
    const thisUser = <IUserDocument>this;
    await thisUser
      .populate({ path: 'albumTags', populate: [{ path: 'tag' }] })
      .execPopulate();

    const result = thisUser.albumTags.reduce((tags, albumTag) => {
      const tag = <ITagDocument>albumTag.tag;
      const foundTag = tags.find(t => (t.tag as ITagDocument).id === tag.id); // I search for another tag with the same id
      if (foundTag) {
        // I have already added this tag, I don't want to push it again
        foundTag.count++;
        return tags;
      }

      const descriptor: TagDescriptor = { tag: tag, count: 1};
      tags.push(descriptor);
      return tags;
    }, <TagDescriptor[]>[]);

    return Promise.resolve(result);

  } catch (error) {
    return Promise.reject(error);
  }
};

userSchema.methods.getTagsByAlbum = async function (spotifyAlbumId: string): Promise<ITagDocument[]> {
  try {
    const thisUser = <IUserDocument>this;
    await thisUser
      .populate({
        path: 'albumTags',
        populate: [{ path: 'tag' }, { path: 'album', select: 'publicId.spotify' }],
        // match: { "album.publicId.spotify": spotifyAlbumId },
      })
      .execPopulate();
    // todo: understand how to make `match` work to avoid `reduce`

    const result = thisUser.albumTags.reduce((tags, albumTag) => {
      if (albumTag.album.publicId.spotify !== spotifyAlbumId) {
        return tags;
      }

      tags.push(<ITagDocument>albumTag.tag);
      return tags;
    }, <ITagDocument[]>[]);

    return Promise.resolve(result);

  } catch (error) {
    return Promise.reject(error);
  }
};

userSchema.methods.addToListeningList = async function (spotifyAlbumId: string): Promise<IUserDocument> {
  try {
    const thisUser = <IUserDocument>this;

    const index = thisUser.listeningList.indexOf(spotifyAlbumId);

    if (index >= 0) {
      throw new BadRequestErrorResponse('Input album already is in the current user\'s listening list');
    }

    thisUser.listeningList.push(spotifyAlbumId);

    const savedUser = await thisUser.save();
    return Promise.resolve(savedUser);
  } catch (error) {
    logger.error(error);
    return Promise.reject(error);
  }
};

userSchema.methods.removeFromListeningList = async function (spotifyAlbumId: string): Promise<IUserDocument> {
  try {
    const user = <IUserDocument>this;

    const countBeforePull = user.listeningList.length;
    const pulledId = (<Types.Array<string>>user.listeningList).pull(spotifyAlbumId);
    const countAfterPull = user.listeningList.length;

    if (countBeforePull === countAfterPull) {
      throw new BadRequestErrorResponse('Input Album is not in current user\'s listening list');
    }

    const savedUser = await user.save();
    logger.debug(`Album deleted from user's listening list`);
    return Promise.resolve(savedUser);
  } catch (error) {
    logger.error(error);
    return Promise.reject(error);
  }
};

userSchema.methods.updateSpotifyAccessToken = async function (spotifyAccessToken: string): Promise<IUserDocument> {
  try {
    const thisUser = <IUserDocument>this;

    thisUser.spotify.accessToken = spotifyAccessToken;
    const newUser = await thisUser.save();

    return Promise.resolve(newUser);

  } catch (error) {
    return Promise.reject(error);
  }
};

userSchema.statics.upsertSpotifyUser = async function (
  profile: UserProfileAuthenticationNodeResponse,
  accessToken: string,
  refreshToken: string): Promise<IUserDocument> {

  try {
    const user = await User.findOne({
      'spotify.id': profile.id
    });

    if (user) {
      user.spotify = Object.assign(user.spotify, { accessToken: accessToken, refreshToken: refreshToken });
      user.displayName = profile.displayName;
      const savedUser0 = await user.save();
      return Promise.resolve(savedUser0);
    }

    // no user was found: we create a new one
    const newUser = new User();
    newUser.spotify = {
      id: profile.id,
      accessToken: accessToken,
      refreshToken: refreshToken,
    };
    newUser.displayName = profile.displayName;

    const savedUser = await newUser.save();
    return Promise.resolve(savedUser);
  } catch (error) {
    return Promise.reject(error);
  }
};

export const User: IUserModel = model<IUserDocument, IUserModel>('User', userSchema);
