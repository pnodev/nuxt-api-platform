import Vue from 'vue';
import jwtDecode from 'jwt-decode';
import createAuthRefreshInterceptor from 'axios-auth-refresh';
import Api from './api';

export default async (ctx, inject) => {
  const options = JSON.parse(`<%= JSON.stringify(options) %>`);

  Api.setOptions({
    baseUrl: options.apiUrl,
    accessTokenEndpoint: options.accessTokenEndpoint,
    refreshTokenEndpoint: options.refreshTokenEndpoint,
    mercureUrl: options.mercureUrl,
    usersEntity: options.usersEntity,
    accessTokenUserIdKey: options.accessTokenUserIdKey,
    softDeletes: options.softDeletes,
    minioApi: options.minioApi,
    minioUser: options.minioUser,
    minioPassword: options.minioPassword,
    minioBucket: options.minioBucket,
  });

  const authModule = {
    namespaced: true,
    state: () => ({
      user: null,
    }),
    mutations: {
      SET_USER(state, user) {
        Vue.set(state, 'user', user);
      },
    },
  };

  const opts = {};
  if (ctx.isClient) {
    opts.preserveState = true;
  }
  ctx.store.registerModule('auth', authModule, opts);

  inject('api', Api);
  inject('auth', new Auth(ctx, options));

  const storedToken = ctx.$cookies.get(options.accessTokenCookieName);
  const storedRefreshToken = ctx.$cookies.get(options.refreshTokenCookieName);
  Api.jwt = storedToken;
  Api.refreshToken = storedRefreshToken;

  if (storedToken && storedRefreshToken) {
    const tokenData = jwtDecode(storedToken);
    const validFor = tokenData.exp * 1000 - Date.now();

    if (validFor < 300000) {
      await ctx.$auth.refresh();
    }
    if (process.client) {
      setTimeout(() => {
        ctx.$auth.refresh();
      }, ctx.$auth._getTimeUntilRefreshNeeded(Api.jwt));
    }
    try {
      const user = await Api.me();
      ctx.store.commit('auth/SET_USER', user);
    } catch (error) {
      ctx.$cookies.remove(options.accessTokenCookieName);
      ctx.$cookies.remove(options.refreshTokenCookieName);
    }
  }
};

/**
 * The Auth object handles all authentication related API communication,
 * as well as persistence of authorization keys
 */
class Auth {
  constructor(ctx, options) {
    this.options = options;
    this.$api = ctx.$api;
    this.$store = ctx.store;
    this.$router = ctx.app.router;
    this.$cookies = ctx.$cookies;
    this.refreshTimer = null;

    // set up AuthRefreshInterceptor to prevent premature 401 errors
    createAuthRefreshInterceptor(this.$api.axios, (failedRequest) => {
      // if the initial request failed, the accessToken probably expired
      // however – the refreshToken might still be valid, so let's try to renew it first
      if (process.client && this.$cookies.get(options.refreshTokenCookieName)) {
        return this.refresh().then((newToken) => {
          failedRequest.response.config.headers.Authorization = `Bearer ${newToken}`;
          return Promise.resolve();
        });
      } else {
        return Promise.reject(failedRequest);
      }
    });
  }

  /**
   * Returns the current user from storage
   */
  get user() {
    return this.$store.state.auth.user;
  }

  /**
   * Performs the login request and handles persistence of necessary tokens
   *
   * @param {object} credentials The credentials needed for login
   *    e.g. {email: 'foo@bar.com', password: 'secret'}
   */
  async login(credentials) {
    try {
      const loginData = await this.$api.login(credentials);
      this.$cookies.set(this.options.accessTokenCookieName, loginData.token);
      this.$cookies.set(
        this.options.refreshTokenCookieName,
        loginData.refresh_token
      );
      const user = await this.$api.me();
      await this.$store.commit('auth/SET_USER', user);
      this.refreshTimer = setTimeout(() => {
        this.refresh();
      }, this._getTimeUntilRefreshNeeded(loginData.token));
      this.$router.push(this.options.homeRoute);
    } catch (error) {
      if (error.message === '401') {
        const authError = new Error('AuthError');
        authError.message = 'Authentication Failure';
        authError.data = 'You entered invalid credentials';
        throw authError;
      }
      if (error.message === 'Network Error') {
        const networkError = new Error('NetworkError');
        networkError.message = 'Network Failure';
        networkError.data = 'No connection to the server';
        throw networkError;
      } else {
        const unexpectedError = new Error('UnexpectedError');
        unexpectedError.message = 'Unexpected Failure';
        unexpectedError.data = 'An unexpected error ocurred';
        throw unexpectedError;
      }
    }
  }

  /**
   * Performs a logout
   */
  async logout() {
    if (process.client) {
      this.refreshTimer = clearTimeout(this.refreshTimer);
    }
    this.$cookies.remove(this.options.accessTokenCookieName);
    this.$cookies.remove(this.options.refreshTokenCookieName);
    this.$api.jwt = '';
    await this.$store.commit('auth/SET_USER', null);
    this.$router.push(this.options.loginRoute);
  }

  /**
   * Refreshes the accessToken
   *
   * @returns {string} The new accessToken
   */
  async refresh() {
    try {
      this.refreshTimer = clearTimeout(this.refreshTimer);
      const response = await this.$api.refresh();

      this.$cookies.set(this.options.accessTokenCookieName, response.token);
      this.$cookies.set(
        this.options.refreshTokenCookieName,
        response.refresh_token
      );

      this.refreshTimer = setTimeout(() => {
        this.refresh();
      }, this._getTimeUntilRefreshNeeded(response.token));
      return response.token;
    } catch (error) {
      if (error.message === 'refreshTokenExpired') {
        this.logout();
      }
    }
  }

  /**
   * Updates the current users password
   *
   * @param {string} the new password
   */
  async changePassword(password) {
    const response = await this.$api.axios.patch('/change_password', {
      password,
    });
    return response;
  }

  /**
   * Calculates the timestamp at which token renewal will be necessary
   *
   * @param {string} token The accessToken
   * @returns {Number}
   */
  _getTimeUntilRefreshNeeded(token) {
    const validUntil = jwtDecode(token).exp;
    return validUntil * 1000 - Date.now() - 300000;
  }
}
