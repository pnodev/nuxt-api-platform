import _ from 'lodash';
import preProcessors from './preProcessors';

/**
 * The Items object is a wrapper for performing CRUD-operations on
 * a specific entity
 */
export default class Items {
  /**
   * Constructor
   *
   * @param {string} name The entity's name (e.g. orders)
   * @param {object} axios The axios instance to be used for API requests
   */
  constructor(name, axios) {
    this.name = name;
    this.axios = axios;
  }

  /**
   * Performs a GET request to read from the API
   * Fetches a specific entry if an ID is provided, or a collection otherwise
   *
   * @param {object} opts Request configuration
   *    Possible configuration options
   *    - id: If set, a specific entry will be fetched
   *    - filter: An array of filters
   *    - sort: An object controlling the sorting (e.g. {prop: 'createdAt', order: 'DESC'})
   *    - page: sets the pagination offset (only relevant for collections)
   * @returns {object} The API response
   */
  async get(opts = {}) {
    let qs = '';

    // filter
    if (opts.filter) {
      Object.keys(opts.filter).forEach((prop) => {
        if (qs === '') {
          qs += '?';
        } else {
          qs += '&';
        }
        if (Array.isArray(opts.filter[prop])) {
          opts.filter[prop].forEach((filterItem, index) => {
            if (index > 0) {
              qs += '&';
            }
            qs += prop + '[]=' + filterItem;
          });
        } else if (typeof opts.filter[prop] === 'object'){
            const keys = Object.keys(opts.filter[prop]);
            const key = keys[0];
            qs += prop + `[${key}]=` +  opts.filter[prop][key];
        } else {
          qs += prop + '=' + opts.filter[prop];
        }
      });
    }

    // sorting
    if (opts.sort) {
      if (qs !== '') {
        qs += '&';
      } else {
        qs += '?';
      }
      qs += `order[${opts.sort.prop}]=${opts.sort.order}`;
    }

    // pagination
    if (opts.page) {
      if (qs !== '') {
        qs += '&';
      } else {
        qs += '?';
      }
      qs += `page=${opts.page}`;
    }

    if (opts.id) {
      // get specific entry
      const { data } = await this.axios.get(
        `/api/${this.name}/${opts.id}${qs}`,
        this._getRequestConfig('GET', opts)
      );
      let result = data;
      if (opts.resolve) {
        result = await this._resolveProps(data, opts.resolve);
      }
      return result;
    } else {
      // get collection
      const { data } = await this.axios.get(
        `/api/${this.name}${qs}`,
        this._getRequestConfig('GET', opts)
      );
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

  /**
   * Returns the axios configuration for a given set of options
   *
   * @param {string} verb The HTTP verb
   * @param {object} config The configuration object
   *    Possible options:
   *    - props: The config for the prop filter
   * @returns {object} The request configuration for axios
   */
  _getRequestConfig(verb, config) {
    if (verb === 'GET') {
      if (config.props) {
        return {
          headers: {
            props: JSON.stringify(this._getProps(config)),
            ...this.axios.defaults.headers.common,
          },
        };
      }
    }
    return {};
  }

  /**
   * Converts the prop filter config into a consumable format
   *
   * @param {object} config The prop filter config
   * @returns {object}
   */
  _getProps(config) {
    const props = {};
    config.props.forEach((prop, index) => {
      if (typeof prop === 'object') {
        props[prop.key] = this._getProps({ props: prop.props });
      } else {
        props[index] = prop;
      }
    });
    return props;
  }

  /**
   * @deprecated
   */
  async _resolveProps(entry, props) {
    // eslint-disable-next-line
    console.warn(
      'The `resolve` option is deprecated and will be removed in the next version. Use the `prop` filter instead.'
    );
    await Promise.all(
      props.map(async (prop) => {
        if (!Object.prototype.hasOwnProperty.call(entry, prop)) {
          return;
        }

        if (Array.isArray(entry[prop])) {
          entry[prop] = await Promise.all(
            entry[prop].map(async (entity) => {
              const { data } = await this.axios.get(entity);
              return data;
            })
          );
        } else {
          const { data } = await this.axios.get(entry[prop]);
          entry[prop] = data;
        }
      })
    );
    return entry;
  }

  /**
   * Performs a POST request to persist a new entry
   *
   * @param {object} entity The entity dataset
   * @param {object} opts additional configuration
   *    Possible options:
   *    - preProcessors: An array of preProcessor configurations
   * @returns {object} The API response
   */
  async create(entity, opts = {}) {
    const payload = _.cloneDeep(entity);
    delete payload['@id'];
    delete payload.createdAt;
    delete payload.updatedAt;
    if (opts.preProcessors) {
      await Promise.all(
        Object.keys(opts.preProcessors).map(async (prop) => {
          payload[prop] = await preProcessors[opts.preProcessors[prop]](
            payload[prop],
            this.axios
          );
        })
      );
    }

    const { data } = await this.axios.post(`/api/${this.name}`, payload, {
      headers: {
        'Content-Type': 'application/ld+json',
        Accept: 'application/ld+json',
      },
    });
    return data;
  }

  /**
   * Performs a PUT request to update an entry
   *
   * @param {object} entity The entity dataset
   * @param {object} opts additional configuration
   *    Possible options:
   *    - preProcessors: An array of preProcessor configurations
   * @returns {object} The API response
   */
  async update(entity, opts = {}) {
    const payload = _.cloneDeep(entity);
    const id = payload['@id'];
    delete payload['@id'];
    delete payload.createdAt;
    delete payload.updatedAt;
    if (opts.preProcessors) {
      await Promise.all(
        Object.keys(opts.preProcessors).map(async (prop) => {
          payload[prop] = await preProcessors[opts.preProcessors[prop]](
            payload[prop],
            this.axios
          );
        })
      );
    }
    const { data } = await this.axios.patch(id, payload, {
      headers: {
        'Content-Type': 'application/merge-patch+json',
        Accept: 'application/ld+json',
      },
    });
    return data;
  }

  /**
   * Performs a DELETE request for a given ID
   *
   * @param {string} id The id of the entry to delete
   * @returns {object} The API response
   */
  async delete(id) {
    const url = id.includes('/api') ? id : `/api/${this.name}/${id}`
    if (api.softDeletes) {
      const date = new Date();
      const str = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " +  date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();
      const deleted = {deleted: str};
      const { data } = await this.axios.patch(url, deleted, {
        headers: {
          'Content-Type': 'application/merge-patch+json',
          Accept: 'application/ld+json',
        }
      });
      return data;
    } else {
      const { data } = await this.axios.delete(url);
      return data;
    }
  }

  async archive(id) {
    const url = id.includes('/api') ? id : `/api/${this.name}/${id}`
    const date = new Date();
    const str = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " +  date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();
    const archived = {archived: str};
    const { data } = await this.axios.patch(url, archived, {
      headers: {
        'Content-Type': 'application/merge-patch+json',
        Accept: 'application/ld+json',
      }
    });
    return data;
  }
}
