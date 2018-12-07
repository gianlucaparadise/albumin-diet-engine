"use strict";

import { Response, Request, NextFunction } from "express";
import { SpotifyApiManager } from "../managers/SpotifyApiManager";
import { TagOnAlbumRequest } from "../models/requests/SetTagOnAlbumRequest";
import { EmptyResponse, BadRequestErrorResponse } from "../models/responses/GenericResponses";
import { Tag } from "../models/Tag";
import { Album } from "../models/Album";
import { AlbumTag } from "../models/AlbumTag";
import { IUser } from "../models/User";
import { GetMyAlbumsResponse } from "../models/responses/GetMyAlbums";
import { GetMyTagsResponse } from "../models/responses/GetMyTags";
import { errorHandler } from "../util/errorHandler";

export let getMyAlbums = async (req: Request, res: Response) => {
  // todo: filter by tag
  // todo: pagination
  try {
    const user = <IUser>req.user;

    const tagsByAlbum = await user.getTagsByAlbum();
    const spotifyAlbums = await SpotifyApiManager.GetMySavedAlbums();
    const response = GetMyAlbumsResponse.createFromSpotifyAlbums(spotifyAlbums.body.items, tagsByAlbum);

    return res.json(response);
  }
  catch (error) {
    return errorHandler(error, res);
  }
};

export const getMyTags = async (req: Request, res: Response) => {
  try {
    const user = <IUser>req.user;

    const tags = await user.getTags();
    const response = new GetMyTagsResponse(tags);

    return res.json(response);
  }
  catch (error) {
    return errorHandler(error, res);
  }
};

export let setTagOnAlbum = async (req: Request, res: Response) => {
  try {
    const body = TagOnAlbumRequest.checkConsistency(req.body);

    const tag = await Tag.findOrCreate(body.tag.name);
    if (!tag) {
      throw new BadRequestErrorResponse("Input tag does not exist");
    }

    // todo: check if album really exists on spotify
    const album = await Album.findOrCreate(body.album.spotifyId);
    if (!album) {
      throw new BadRequestErrorResponse("Input album has never been tagged");
    }

    const albumTag = await AlbumTag.findOrCreate(album, tag);
    if (!albumTag) {
      throw new BadRequestErrorResponse("Input tag has never been added to input album");
    }

    const user = <IUser>req.user;
    const savedUser = await user.addAlbumTag(albumTag);

    return res.json(new EmptyResponse(undefined));
  }
  catch (error) {
    return errorHandler(error, res);
  }
};

export const deleteTagFromAlbum = async (req: Request, res: Response) => {
  try {
    const body = TagOnAlbumRequest.checkConsistency(req.body);

    const tagUniqueId = Tag.calculateUniqueIdByName(body.tag.name);
    const tag = await Tag.findOne({ "uniqueId": tagUniqueId });
    if (!tag) {
      throw new BadRequestErrorResponse("Input tag does not exist");
    }

    const album = await Album.findOne({ "publicId.spotify": body.album.spotifyId });
    if (!album) {
      throw new BadRequestErrorResponse("Input album has never been tagged");
    }

    const albumTag = await AlbumTag.findOne({ "tag": tag, "album": album });
    if (!albumTag) {
      throw new BadRequestErrorResponse("Input tag has never been added to input album");
    }

    // todo: startTransaction

    const user = <IUser>req.user;
    const removeResult = await user.removeAlbumTag(albumTag);

    // Clearing orphan documents
    const isAlbumTagRemoved = await albumTag.removeIfOrphan();
    if (isAlbumTagRemoved) {
      // If AlbumTag was orphan, I check if album and tag are now also orphan
      const isAlbumRemoved = await album.removeIfOrphan();
      const isTagRemoved = await tag.removeIfOrphan();
    }

    // todo: commitTransaction

    return res.json(new EmptyResponse(undefined));
  }
  catch (error) {
    return errorHandler(error, res);
  }
};