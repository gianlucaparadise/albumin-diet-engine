import { SPOTIFY_ID, SPOTIFY_SECRET } from "../util/secrets";
import { IUser } from "../models/User";
import logger from "../util/logger";

import SpotifyWebApi from "spotify-web-api-node";

// credentials are optional
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_ID,
  clientSecret: SPOTIFY_SECRET,
});

export class SpotifyApiManager {
  private static _instance: SpotifyApiManager;

  private constructor() {

  }

  public static get Instance() {
    // Do you need arguments? Make it a regular method instead.
    return this._instance || (this._instance = new this());
  }

  private get Api() {
    return spotifyApi;
  }

  public static get Api() {
    return this.Instance.Api;
  }

  private static async RefreshToken(user: IUser): Promise<boolean> {
    logger.debug("Refreshing spotify token");

    try {
      const data = await SpotifyApiManager.Api.refreshAccessToken();

      const accessToken: string = data.body["access_token"];

      const newUser = await user.updateSpotifyAccessToken(accessToken);

      SpotifyApiManager.Api.setAccessToken(accessToken);
      return Promise.resolve(true);

    } catch (error) {
      logger.error("Error while refreshing token: ");
      logger.error(error);

      return Promise.reject(error);
    }
  }

  /**
   * This is something like a middleware for all the requests that needs
   * the token to be refreshed when needed
   *
   * @param user Current user
   * @param buildRequest Function that returns the request to perform.
   */
  private static async request<T>(user: IUser, buildRequest: () => Promise<T>): Promise<T> {
    try {
      // I need a request builder instead of the final request because if I don't re-build it,
      // the request will use the old spotifyApi instance with the old accessToken
      const req = buildRequest();
      return await req;
    }
    catch (error) {
      if (error.statusCode == 401) {
        const hasRefreshed = await SpotifyApiManager.RefreshToken(user);
        if (hasRefreshed) {
          // now that is refreshed, I re-try one last time the initial request
          try {
            const req = buildRequest();
            return await req;
          }
          catch (error2) {
            // If I get again an error, I don't want to try another time to avoid a long loop
            return Promise.reject(error2);
          }
        }
      }
      return Promise.reject(error);
    }
  }

  public static async GetMySavedAlbums(user: IUser, limit: number = 20, offset: number = 0): Promise<SpotifyApi.UsersSavedAlbumsNodeResponse> {

    try {
      const params: SpotifyApi.PagingRequestObject = {
        limit: limit,
        offset: offset
      };
      const response = await this.request(user, () => SpotifyApiManager.Api.getMySavedAlbums(params));

      // todo: filter out singles, but not EPs (see: https://support.tunecore.com/hc/en-ca/articles/115006689928-What-is-the-difference-between-a-Single-an-EP-and-an-Album-)

      return Promise.resolve(response);
    }
    catch (error) {
      return Promise.reject(error);
    }
  }

  public static async GetAlbums(user: IUser, ids: string[]): Promise<SpotifyApi.MultipleAlbumsNodeResponse> {

    try {
      const response = await this.request(user, () => SpotifyApiManager.Api.getAlbums(ids));

      // todo: filter out singles, but not EPs (see: https://support.tunecore.com/hc/en-ca/articles/115006689928-What-is-the-difference-between-a-Single-an-EP-and-an-Album-)

      return Promise.resolve(response);
    }
    catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * This API checks if all the tracks of the input album are saved. If so, the album is fully saved.
   *
   * @param user Current user
   * @param album Album to check
   */
  public static async IsMySavedAlbum(user: IUser, album: SpotifyApi.AlbumObjectFull): Promise<boolean> {

    try {
      const trackIds = album.tracks.items.map(t => t.id);

      // FIXME: This API supports max 50 tracks. If input album has more than 50 tracks, I need to check tracks in blocks of 50 tracks
      const response = await this.request(user, () => SpotifyApiManager.Api.containsMySavedTracks(trackIds));
      const result = response.body.indexOf(false) == -1;

      // I can't use containsMySavedTracks API because returns true when at least one track is saved. I need to check full albums.

      return Promise.resolve(result);
    }
    catch (error) {
      return Promise.reject(error);
    }
  }

  public static async SearchAlbums(user: IUser, keywords: string, limit: number, offset: number): Promise<SpotifyApi.AlbumSearchNodeResponse> {

    try {
      const options = {
        limit: limit,
        offset: offset
      };
      const response = await this.request(user, () => SpotifyApiManager.Api.searchAlbums(keywords, options));

      // todo: filter out singles, but not EPs (see: https://support.tunecore.com/hc/en-ca/articles/115006689928-What-is-the-difference-between-a-Single-an-EP-and-an-Album-)

      return Promise.resolve(response);
    }
    catch (error) {
      return Promise.reject(error);
    }
  }

  public static async SearchArtists(user: IUser, keywords: string, limit: number, offset: number): Promise<SpotifyApi.ArtistSearchNodeResponse> {

    try {
      const options = {
        limit: limit,
        offset: offset
      };
      const response = await this.request(user, () => SpotifyApiManager.Api.searchArtists(keywords, options));

      return Promise.resolve(response);
    }
    catch (error) {
      return Promise.reject(error);
    }
  }
}