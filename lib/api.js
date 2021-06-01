import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import fecha from 'fecha';
import _ from 'lodash';
import pluralize from 'pluralize';

axios.interceptors.response.use(
  (res) => {
    return res;
  },
  (error) => {
    if (error.response.status === 401) {
      throw new Error('401');
    } else if (error.response.status === 418) {
      return Promise.reject(new Error('duplicate'));
    }
    return Promise.reject(error);
  }
);

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

const preProcessors = {
  mediaObject: async (value) => {
    if (value === null) {
      return value;
    }
    if (typeof value === 'object' && value.base64) {
      const { data } = await axios.post(
        '/api/media_objects',
        {
          id: uuidv4(),
          createdAt: fecha.format(new Date(), 'YYYY-MM-DD HH:mm:ss'),
          base64: value.base64,
          caption: value.caption,
          sort: value.sort,
        },
        {
          headers: {
            'Content-Type': 'application/ld+json',
            Accept: 'application/ld+json',
          },
        }
      );
      return data['@id'];
    } else if (Array.isArray(value)) {
      value = await Promise.all(
        value.map(async (file) => {
          if (typeof file === 'object' && file.base64) {
            const { data } = await axios.post('/api/media_objects', {
              id: uuidv4(),
              createdAt: fecha.format(new Date(), 'YYYY-MM-DD HH:mm:ss'),
              caption: file.caption,
              sort: file.sort,
              base64: file.base64,
            });
            return data['@id'];
          } else if (typeof file === 'object') {
            delete file.contentUrl;
            await axios.patch(file['@id'], file, {
              headers: {
                'Content-Type': 'application/merge-patch+json',
                Accept: 'application/ld+json',
              },
            });
            return file['@id'];
          }
          return file;
        })
      );
    } else if (typeof value === 'object') {
      delete value.contentUrl;
      await axios.patch(value['@id'], value, {
        headers: {
          'Content-Type': 'application/merge-patch+json',
          Accept: 'application/ld+json',
        },
      });
      return value['@id'];
    }
    return value;
  },
};

class Items {
  constructor(name) {
    this.name = name;
  }

  async get(opts = {}) {
    let qs = '';
    if (opts.filter) {
      Object.keys(opts.filter).forEach((prop) => {
        if (qs === '') {
          qs += '?';
        } else {
          qs += '&';
        }
        qs += prop + '=' + opts.filter[prop];
      });
    }
    if (opts.sort) {
      if (qs !== '') {
        qs += '&';
      } else {
        qs += '?';
      }
      qs += `order[${opts.sort.prop}]=${opts.sort.order}`;
    }
    if (opts.page) {
      if (qs !== '') {
        qs += '&';
      } else {
        qs += '?';
      }
      qs += `page=${opts.page}`;
    }
    if (opts.id) {
      const { data } = await axios.get(`/api/${this.name}/${opts.id}${qs}`);
      let result = data;
      if (opts.resolve) {
        result = await this._resolveProps(data, opts.resolve);
      }
      return result;
    } else {
      const { data } = await axios.get(`/api/${this.name}${qs}`);
      let results = data['hydra:member'];
      if (results.length > 0 && opts.resolve) {
        results = await Promise.all(
          results.map(
            async (data) => await this._resolveProps(data, opts.resolve)
          )
        );
      }
      return {
        pagination:
          data['hydra:view'] && data['hydra:view']['@id'].includes('page=')
            ? {
                current: parseInt(
                  data['hydra:view']['@id'].match(/[?|&]page=([0-9]+)/)[1]
                ),
                first: parseInt(
                  data['hydra:view']['hydra:first'].match(
                    /[?|&]page=([0-9]+)/
                  )[1]
                ),
                last: parseInt(
                  data['hydra:view']['hydra:last'].match(
                    /[?|&]page=([0-9]+)/
                  )[1]
                ),
                previous: data['hydra:view']['hydra:previous']
                  ? parseInt(
                      data['hydra:view']['hydra:previous'].match(
                        /[?|&]page=([0-9]+)/
                      )[1]
                    )
                  : null,
                next: data['hydra:view']['hydra:next']
                  ? parseInt(
                      data['hydra:view']['hydra:next'].match(
                        /[?|&]page=([0-9]+)/
                      )[1]
                    )
                  : null,
                totalItemsCount: data['hydra:totalItems'],
                itemsCount: results.length,
              }
            : null,
        data: results,
      };
    }
  }

  async _resolveProps(entry, props) {
    await Promise.all(
      props.map(async (prop) => {
        if (!Object.prototype.hasOwnProperty.call(entry, prop)) {
          return;
        }

        if (Array.isArray(entry[prop])) {
          entry[prop] = await Promise.all(
            entry[prop].map(async (entity) => {
              const { data } = await axios.get(entity);
              return data;
            })
          );
        } else {
          const { data } = await axios.get(entry[prop]);
          entry[prop] = data;
        }
      })
    );
    return entry;
  }

  async create(entity, opts = {}) {
    const payload = _.cloneDeep(entity);
    delete payload['@id'];
    if (opts.preProcessors) {
      await Promise.all(
        Object.keys(opts.preProcessors).map(async (prop) => {
          payload[prop] = await preProcessors[opts.preProcessors[prop]](
            payload[prop]
          );
        })
      );
    }
    console.log(payload);
    const { data } = await axios.post(`/api/${this.name}`, payload, {
      headers: {
        'Content-Type': 'application/ld+json',
        Accept: 'application/ld+json',
      },
    });
    return data;
  }

  async update(entity, opts = {}) {
    const payload = _.cloneDeep(entity);
    const id = payload['@id'];
    delete payload['@id'];
    if (opts.preProcessors) {
      await Promise.all(
        Object.keys(opts.preProcessors).map(async (prop) => {
          payload[prop] = await preProcessors[opts.preProcessors[prop]](
            payload[prop]
          );
        })
      );
    }
    const { data } = await axios.patch(id, payload, {
      headers: {
        'Content-Type': 'application/merge-patch+json',
        Accept: 'application/ld+json',
      },
    });
    return data;
  }

  async delete(id) {
    const { data } = await axios.delete(
      id.includes('/api') ? id : `/api/${this.name}/${id}`
    );
    return data;
  }
}

export default new Api();
