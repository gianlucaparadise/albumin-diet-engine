import { Response, Request, NextFunction } from 'express';
import { SpotifyApiManager } from '../managers/SpotifyApiManager';
import { AlbumManager } from '../managers/AlbumManager';
import { TagOnAlbumRequest } from '../models/public/SetTagOnAlbumRequest';
import { AlbumRequest } from '../models/public/AlbumRequest';
import { EmptyResponse, BadRequestErrorResponse, BasePaginationRequest, ErrorResponse } from '../models/public/GenericResponses';
import { Tag } from '../models/Tag';
import { Album } from '../models/Album';
import { AlbumTag } from '../models/AlbumTag';
import { IUserDocument } from '../models/User';
import { GetMyAlbumsResponse, GetMyAlbumsRequest, GetAlbumResponse, UserAlbumsResponse } from '../models/public/GetMyAlbums';
import { GetMyTagsResponse } from '../models/public/GetMyTags';
import { SearchRequest, SearchArtistResponse } from '../models/public/Search';
import { errorHandler } from '../util/errorHandler';
import logger from '../util/logger';
import { AlbumObjectFull } from 'spotify-web-api-node-typings';

export let getMyAlbums = async (req: Request, res: Response) => {
  try {
    console.log(req.query);
    const request = <GetMyAlbumsRequest>req.query;

    const tags: string[] = JSON.parse(request.tags || '[]');
    const normalizedTags = tags.map(t => Tag.calculateUniqueIdByName(t));

    const untagged = request.untagged && request.untagged.toLowerCase() === 'true';

    const limit = parseInt(request.limit, 10) || 20;
    const offset = parseInt(request.offset, 10) || 0;

    const user = <IUserDocument>req.user;

    const tagsByAlbum = await user.getTagsGroupedByAlbum();
    const spotifyAlbums = await AlbumManager.GetMySavedAlbums(user, tagsByAlbum, normalizedTags, untagged, limit, offset);

    const response = GetMyAlbumsResponse.createFromSpotifyAlbums(spotifyAlbums, tagsByAlbum, user);

    return res.json(response);
  } catch (error) {
    return errorHandler(error, res);
  }
};

export let saveAlbum = async (req: Request, res: Response) => {
  try {
    const user = <IUserDocument>req.user;
    const body = AlbumRequest.checkConsistency(req.body);

    const spotifyId = body.album.spotifyId;
    await SpotifyApiManager.AddToMyAlbum(user, spotifyId);

    const response = await _getAlbumBySpotifyId(user, spotifyId);

    return res.json(response);
  } catch (error) {
    return errorHandler(error, res);
  }
};

export let removeAlbum = async (req: Request, res: Response) => {
  try {
    const user = <IUserDocument>req.user;
    const body = AlbumRequest.checkConsistency(req.body);

    const spotifyId = body.album.spotifyId;
    await SpotifyApiManager.RemoveFromMyAlbum(user, spotifyId);

    return res.json(new EmptyResponse());
  } catch (error) {
    return errorHandler(error, res);
  }
};

async function _getAlbumBySpotifyId(user: IUserDocument, spotifyAlbumId: string) {
    const tags = await user.getTagsByAlbum(spotifyAlbumId);

    const spotifyAlbums = await AlbumManager.GetAlbums(user, [spotifyAlbumId]);
    if (!spotifyAlbums || spotifyAlbums.length < 1) {
      throw new ErrorResponse('400', 'Input album is a single', 400);
    }
    const album = spotifyAlbums[0];

    const isSavedAlbumResponse = await SpotifyApiManager.IsMySavedAlbum(user, album);

    const response = GetAlbumResponse.createFromSpotifyAlbum(album, tags, isSavedAlbumResponse, user);
    return response;
}

export let getAlbumBySpotifyId = async (req: Request, res: Response) => {
  try {
    const spotifyAlbumId = req.params['albumId'];
    const user = <IUserDocument>req.user;

    const response = await _getAlbumBySpotifyId(user, spotifyAlbumId);

    return res.json(response);
  } catch (error) {
    return errorHandler(error, res);
  }
};

export const getMyTags = async (req: Request, res: Response) => {
  try {
    const user = <IUserDocument>req.user;

    // todo: paginate this

    const tags = await user.getTags();
    const response = new GetMyTagsResponse(tags);

    return res.json(response);
  } catch (error) {
    return errorHandler(error, res);
  }
};

export let setTagOnAlbum = async (req: Request, res: Response) => {
  try {
    const body = TagOnAlbumRequest.checkConsistency(req.body);

    // todo: formal check on tag

    const tag = await Tag.findOrCreate(body.tag.name);
    if (!tag) {
      throw new BadRequestErrorResponse('Input tag does not exist');
    }

    // todo: check if album really exists on spotify
    const album = await Album.findOrCreate(body.album.spotifyId);
    if (!album) {
      throw new BadRequestErrorResponse('Input album has never been tagged');
    }

    const albumTag = await AlbumTag.findOrCreate(album, tag);
    if (!albumTag) {
      throw new BadRequestErrorResponse('Input tag has never been added to input album');
    }

    const user = <IUserDocument>req.user;
    const savedUser = await user.addAlbumTag(albumTag);

    return res.json(new EmptyResponse());
  } catch (error) {
    return errorHandler(error, res);
  }
};

export const deleteTagFromAlbum = async (req: Request, res: Response) => {
  try {
    const body = TagOnAlbumRequest.checkConsistency(req.body);

    const tagUniqueId = Tag.calculateUniqueIdByName(body.tag.name);
    const tag = await Tag.findOne({ 'uniqueId': tagUniqueId });
    if (!tag) {
      throw new BadRequestErrorResponse('Input tag does not exist');
    }

    const album = await Album.findOne({ 'publicId.spotify': body.album.spotifyId });
    if (!album) {
      throw new BadRequestErrorResponse('Input album has never been tagged');
    }

    const albumTag = await AlbumTag.findOne({ 'tag': tag, 'album': album });
    if (!albumTag) {
      throw new BadRequestErrorResponse('Input tag has never been added to input album');
    }

    // todo: startTransaction (see: https://thecodebarbarian.com/a-node-js-perspective-on-mongodb-4-transactions.html)
    // NB: MongoDB currently only supports transactions on replica sets

    const user = <IUserDocument>req.user;
    const removeResult = await user.removeAlbumTag(albumTag);

    // Clearing orphan documents
    const isAlbumTagRemoved = await albumTag.removeIfOrphan();
    if (isAlbumTagRemoved) {
      // If AlbumTag was orphan, I check if album and tag are now also orphan
      const isAlbumRemoved = await album.removeIfOrphan();
      const isTagRemoved = await tag.removeIfOrphan();
    }

    // todo: commitTransaction

    return res.json(new EmptyResponse());
  } catch (error) {
    return errorHandler(error, res);
  }
};

export const getListeningList = async (req: Request, res: Response) => {
  try {
    const request = <BasePaginationRequest>req.query;

    const limit = parseInt(request.limit, 10) || 20;
    const offset = parseInt(request.offset, 10) || 0;

    const user = <IUserDocument>req.user;
    let spotifyIds: string[] = user.listeningList;

    // I filter spotify ids using offset and limit
    spotifyIds = spotifyIds.slice(offset, offset + limit);

    let albumsFull: AlbumObjectFull[] = [];
    if (spotifyIds.length > 0) {
      albumsFull = await AlbumManager.GetAlbums(user, spotifyIds); // FIXME: this call might break pagination
    }

    const response = UserAlbumsResponse.createFromSpotifyAlbums(albumsFull, true);

    return res.json(response);
  } catch (error) {
    return errorHandler(error, res);
  }
};

export const addToListeningList = async (req: Request, res: Response) => {
  try {
    const body = AlbumRequest.checkConsistency(req.body);

    const user = <IUserDocument>req.user;
    const albumSpotifyId = body.album.spotifyId;

    const result = await user.addToListeningList(albumSpotifyId);

    return res.json(new EmptyResponse());
  } catch (error) {
    return errorHandler(error, res);
  }
};

export const deleteFromListeningList = async (req: Request, res: Response) => {
  try {
    const body = AlbumRequest.checkConsistency(req.body);

    const user = <IUserDocument>req.user;
    const albumSpotifyId = body.album.spotifyId;

    const result = await user.removeFromListeningList(albumSpotifyId);

    return res.json(new EmptyResponse());
  } catch (error) {
    return errorHandler(error, res);
  }
};

export const searchAlbums = async (req: Request, res: Response) => {
  try {
    const requestBody = <SearchRequest>req.query;
    const keywords = requestBody.q;

    const limit = parseInt(requestBody.limit, 10) || 20;
    const offset = parseInt(requestBody.offset, 10) || 0;

    const user = <IUserDocument>req.user;

    const albums = await AlbumManager.SearchAlbums(user, keywords, limit, offset);

    const response = UserAlbumsResponse.createFromSpotifyAlbums(albums, user.listeningList);

    return res.json(response);
  } catch (error) {
    return errorHandler(error, res);
  }
};

export const searchArtists = async (req: Request, res: Response) => {
  try {
    const requestBody = <SearchRequest>req.query;
    const keywords = requestBody.q;

    const limit = parseInt(requestBody.limit, 10) || 20;
    const offset = parseInt(requestBody.offset, 10) || 0;

    const user = <IUserDocument>req.user;

    const searchResponse = await SpotifyApiManager.SearchArtists(user, keywords, limit, offset);

    const response = new SearchArtistResponse(searchResponse.body);

    return res.json(response);
  } catch (error) {
    return errorHandler(error, res);
  }
};
