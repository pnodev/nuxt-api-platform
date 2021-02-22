import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import fecha from 'fecha';
import _ from 'lodash';
import pluralize from 'pluralize';

class Api {
  setOptions({
    jwt = null,
    baseUrl = null,
    accessTokenEndpoint = null,
    refreshTokenEndpoint = null,
    mercureUrl = null,
  }) {
    this.jwt = jwt;
    this.baseUrl = baseUrl;
    this.accessTokenEndpoint = accessTokenEndpoint;
    this.refreshTokenEndpoint = refreshTokenEndpoint;
    this.mercureUrl = mercureUrl;
    this.eventSource = null;
    this.eventSourceHandlers = {};
  }

  listenTo(sources) {
    if (!this.mercureUrl) {
      throw new Error(
        'You need to provide the URL to the event server via `options.mercureUrl` in order to use listeners.'
      );
    }
    const url = new URL(this.mercureUrl);
    sources.forEach((source) => {
      url.searchParams.append(
        'topic',
        `${this.baseUrl}/api/${source.topic}/{id}`
      );
      this.eventSourceHandlers[_.capitalize(pluralize(source.topic, 1))] =
        source.handler;
    });
    this.eventSource = new EventSource(url);
    this.eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!data['@type']) {
        // must be a deletion
        const extractedType = data['@id'].replace('/api/', '').split('/')[0];
        const type = _.capitalize(pluralize(extractedType, 1));
        this.eventSourceHandlers[type]({
          type: 'delete',
          data,
        });
      } else {
        this.eventSourceHandlers[data['@type']]({
          type: 'update',
          data,
        });
      }
    };
    this.eventSource.onerror = (error) => console.error(error);
  }

  get axios() {
    return axios;
  }

  set baseUrl(baseUrl) {
    this._baseUrl = baseUrl;
    axios.defaults.baseURL = baseUrl;
  }

  get baseUrl() {
    return this._baseUrl;
  }

  set jwt(token) {
    if (!token) {
      axios.defaults.headers.common.Authorization = undefined;
    } else {
      axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    }
    this._jwt = token;
  }

  get jwt() {
    return this._jwt;
  }

  set refreshToken(token) {
    this._refreshToken = token;
  }

  get refreshToken() {
    return this._refreshToken;
  }

  async login(credentials) {
    const { data } = await axios.post(this.accessTokenEndpoint, credentials);
    this.jwt = data.token;
    this.refreshToken = data.refreshToken;
    return data;
  }

  async refresh() {
    const { data } = await axios.post(
      this.refreshTokenEndpoint,
      { refresh_token: this.refreshToken },
      { headers: { Authorization: '' }, skipAuthRefresh: true }
    );
    this.jwt = data.token;
    this.refreshToken = data.refresh_token;
    return data;
  }

  async me() {
    const { data } = await axios.get('/me');
    return data;
  }

  createEntity(name, data) {
    const id = uuidv4();
    return {
      id,
      '@id': `/api/${name}/${id}`,
      createdAt: fecha.format(new Date(), 'YYYY-MM-DD HH:mm:ss'),
      ...data,
    };
  }

  items(name) {
    return new Items(name);
  }
}

class Items {
  constructor(name) {
    this.name = name;
  }

  async get(opts) {
    let qs = '';
    if (opts && opts.filter) {
      Object.keys(opts.filter).forEach((prop) => {
        if (qs === '') {
          qs += '?';
        } else {
          qs += '&';
        }
        qs += prop + '=' + opts.filter[prop];
      });
    }
    const { data } = await axios.get(`/api/${this.name}${qs}`);
    return data['hydra:member'];
  }

  async create(entity) {
    const payload = _.cloneDeep(entity);
    delete payload['@id'];
    const { data } = await axios.post(`/api/${this.name}`, payload, {
      headers: {
        'Content-Type': 'application/ld+json',
        Accept: 'application/ld+json',
      },
    });
    return data;
  }

  async update(entity) {
    const payload = _.cloneDeep(entity);
    const id = payload['@id'];
    delete payload['@id'];
    const { data } = await axios.patch(id, payload, {
      headers: {
        'Content-Type': 'application/merge-patch+json',
        Accept: 'application/ld+json',
      },
    });
    return data;
  }

  async delete(id) {
    const { data } = await axios.delete(id);
    return data;
  }
}

export default new Api();
