import { Document, Schema, Model, model } from "mongoose";
import { ITag } from "./Tag";

export interface IAlbum extends Document {
  // name: string;
  publicId: {
    spotify: string
  };

  tags: ITag[];
  // url: {
  //   spotify: string
  // };
  // cover: {
  //   spotify: string
  // };
  // info: {
  //   releaseYear: string
  // };
  // artist: {
  //   name: string
  // };
}

export interface IAlbumModel extends Model<IAlbum> {
  findOrCreate(id: string): Promise<IAlbum>;
}

export const albumSchema = new Schema({
  // name: String,
  publicId: {
    spotify: String
  },
  tags: [{ type: Schema.Types.ObjectId, ref: "Tag" }],
  // url: {
  //   spotify: String
  // },
  // cover: {
  //   spotify: String
  // },
  // info: {
  //   releaseYear: String
  // },
  // artist: {
  //   name: String
  // }
}, { timestamps: true, usePushEach: true });

albumSchema.statics.findOrCreate = async (id: string): Promise<IAlbum> => {
  try {
    const album = await Album.findOne({ "publicId.spotify": id });
    if (album) {
      console.log("Album found");
      return Promise.resolve(album);
    }

    console.log("Album creation");
    const newAlbum = new Album();
    newAlbum.publicId = { spotify: id };
    const savedAlbum = await newAlbum.save();

    return Promise.resolve(savedAlbum);
  }
  catch (error) {
    return Promise.reject(error);
  }
};

export const Album = model<IAlbum, IAlbumModel>("Album", albumSchema);