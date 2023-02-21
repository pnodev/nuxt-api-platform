import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import _ from 'lodash';
import pluralize from 'pluralize';
import jwtDecode from 'jwt-decode';
import Items from './items';

// set up interceptor to catch API errors early and handle them properly
axios.interceptors.response.use(
  // if this callback gets triggered, everything went well
  // and we can just bypass the response
  (res) => {
    return res;
  },
  // this is where we can react to specific errors
  (error) => {
    if (error.response && error.response.status === 401) {
      // user is not authenticated -> we just throw an internal error
      // that can be handled one level up
      const authError = new Error('AuthError');
      authError.message = error.response.data.message;
      authError.code = 401;
      throw authError;
    } else if (error.response && error.response.status === 418) {
      // 418 indicates that the dataset has already been inserted into the
      // database – misusing 418 here is a hacky solution, maybe we come up with
      // something better in the future
      return Promise.reject(new Error('duplicate'));
    }
    return Promise.reject(error);
  }
);

class Api {
  /**
   * This method can be used to set all configuration options for
   * the API-wrapper
   *
   * @param {object} param0 The configuration object
   */
  setOptions({
    jwt = null,
    baseUrl = null,
    accessTokenEndpoint = null,
    refreshTokenEndpoint = null,
    mercureUrl = null,
    usersEntity = null,
    accessTokenUserIdKey = null,
    softDeletes = null,
    minioApi = null,
    minioUser = null,
    minioPassword = null,
    minioBucket = null,
    defaultMediaProvider = null,
  }) {
    this.jwt = jwt;
    this.baseUrl = baseUrl;
    this.accessTokenEndpoint = accessTokenEndpoint;
    this.refreshTokenEndpoint = refreshTokenEndpoint;
    this.mercureUrl = mercureUrl;
    this.eventSource = null;
    this.eventSourceHandlers = {};
    this.usersEntity = usersEntity;
    this.accessTokenUserIdKey = accessTokenUserIdKey;
    this.softDeletes = softDeletes;
    this.mediaOptions = {
      [defaultMediaProvider]: {
        minioApi,
        minioUser,
        minioPassword,
        minioBucket,
      },
    };
  }

  /**
   * Register EventSourceHandlers for mercure events
   *
   * @param {array} sources An array of EventSource-configuration objects
   *    e.g. { topic: 'https://api.foo.com/orders/{id}', handler: ({type, data}) => {console.log(type, data)} }
   */
  listenTo(sources) {
    if (!this.mercureUrl) {
      throw new Error(
        'You need to provide the URL to the event server via `options.mercureUrl` in order to use listeners.'
      );
    }
    const url = new URL(this.mercureUrl);

    // iterate over all sources and combine them in one URL
    sources.forEach((source) => {
      url.searchParams.append(
        'topic',
        `${this.baseUrl}/api/${source.topic}/{id}`
      );
      this.eventSourceHandlers[_.capitalize(pluralize(source.topic, 1))] =
        source.handler;
    });

    // create the actual EventSource
    this.eventSource = new EventSource(url);

    // Handle incoming messages
    this.eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!data['@type']) {
        // must be a deletion
        const extractedType = data['@id'].replace('/api/', '').split('/')[0];
        const type = _.capitalize(pluralize(extractedType, 1));

        // call the registered EventSourceHandler
        this.eventSourceHandlers[type]({
          type: 'delete',
          data,
        });
      } else {
        // call the registered EventSourceHandler
        this.eventSourceHandlers[data['@type']]({
          type: 'update',
          data,
        });
      }
    };
    // eslint-disable-next-line no-console
    this.eventSource.onerror = (error) => console.error(error);
  }

  /**
   * Returns the pre-configured axios instance
   */
  get axios() {
    return axios;
  }

  /**
   * Overrides the baseUrl
   */
  set baseUrl(baseUrl) {
    this._baseUrl = baseUrl;
    axios.defaults.baseURL = baseUrl;
  }

  /**
   * Returns the currently used baseUrl
   */
  get baseUrl() {
    return this._baseUrl;
  }

  /**
   * Sets the JWT to be used. Pass null to delete the Authorization-header
   */
  set jwt(token) {
    if (!token) {
      axios.defaults.headers.common.Authorization = undefined;
    } else {
      axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    }
    this._jwt = token;
  }

  /**
   * Returns the currently used JWT
   */
  get jwt() {
    return this._jwt;
  }

  /**
   * Overrides the refreshToken
   */
  set refreshToken(token) {
    this._refreshToken = token;
  }

  /**
   * Returns the currently used refreshToken
   */
  get refreshToken() {
    return this._refreshToken;
  }

  /**
   * Perform a login attempt with the given credentials
   *
   * @param {object} credentials The credentials needed for login
   *    e.g. {email: 'foo@bar.com', password: 'secret'}
   * @returns The API response
   */
  async login(credentials) {
    const { data } = await axios.post(this.accessTokenEndpoint, credentials);
    this.jwt = data.token;
    this.refreshToken = data.refresh_token;
    return data;
  }

  /**
   * Refreshes both tokens
   *
   * @returns {object} The API response, containing the new tokens
   */
  async refresh() {
    try {
      const { data } = await axios.post(
        this.refreshTokenEndpoint,
        { refresh_token: this.refreshToken },
        { headers: { Authorization: '' }, skipAuthRefresh: true }
      );
      this.jwt = data.token;
      this.refreshToken = data.refresh_token;
      return data;
    } catch (error) {
      if (error.message === '401') {
        throw new Error('refreshTokenExpired');
      }
    }
  }

  /**
   * Fetches the current user object from the API
   *
   * @returns {object} The object representing the current user
   */
  async me() {
    const tokenPayload = jwtDecode(this.jwt);
    const userId = tokenPayload[this.accessTokenUserIdKey];
    const { data } = await axios.get(`/api/${this.usersEntity}/${userId}`);
    return data;
  }

  /**
   * Creates an entity-object for given data
   * This method will add all necessary props, like id and @id
   *
   * @param {string} name The entity's name (e.g. orders)
   * @param {object} data The payload
   * @returns {object} The ready-to-use entity object
   */
  createEntity(name, data) {
    const id = uuidv4();
    return {
      id,
      '@id': `/api/${name}/${id}`,
      ...data,
    };
  }

  /**
   * Returns an items object for a given entity to perform CRUD-operations on it
   *
   * @param {string} name The entity's name (e.g. orders)
   * @returns {object} The items object
   */
  items(name) {
    return new Items(name, axios, this.mediaOptions);
  }
}

export default new Api();
