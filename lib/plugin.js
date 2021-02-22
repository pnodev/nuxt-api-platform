import Vue from 'vue';
import jwtDecode from 'jwt-decode';
import createAuthRefreshInterceptor from 'axios-auth-refresh';
import Api from './api'

export default async (ctx, inject) => {
  const options = <%= JSON.stringify(options, null, 2) %>;

  Api.setOptions({
    baseUrl: options.apiUrl,
    accessTokenEndpoint: options.accessTokenEndpoint,
    refreshTokenEndpoint: options.refreshTokenEndpoint,
    mercureUrl: options.mercureUrl
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

class Auth {
  constructor(ctx, options) {
    this.options = options;
    this.$api = ctx.$api;
    this.$store = ctx.store;
    this.$router = ctx.app.router;
    this.$cookies = ctx.$cookies;
    this.refreshTimer = null;

    createAuthRefreshInterceptor(this.$api.axios, failedRequest => {
      if (process.client && this.$cookies.get(options.refreshTokenCookieName)) {
        return this.refresh().then((newToken) => {
            failedRequest.response.config.headers['Authorization'] = `Bearer ${newToken}`;
            return Promise.resolve();
        });
      } else {
        return Promise.reject(failedRequest);
      }
    });
  }

  get user() {
    return this.$store.state.auth.user;
  }

  async login(credentials) {
    try {
      const loginData = await this.$api.login(credentials);
      this.$cookies.set(this.options.accessTokenCookieName, loginData.token);
      this.$cookies.set(this.options.refreshTokenCookieName, loginData.refresh_token);
      const user = await this.$api.me();
      await this.$store.commit('auth/SET_USER', user);
      this.refreshTimer = setTimeout(() => {
        this.refresh();
      }, this._getTimeUntilRefreshNeeded(loginData.token));
      this.$router.push(this.options.homeRoute);
    } catch (error) {
      if (error.response.status === 401) {
        const authError = new Error('AuthError');
        authError.message = 'Authentication Failure';
        authError.data = error.response.data.errors;
        throw authError;
      }
    }
  }

  async logout() {
    await this.$directus.axios.post('/auth/logout', {
      refresh_token: this.$cookies.get(this.options.refreshTokenCookieName),
    });
    if (process.client) {
      this.refreshTimer = clearTimeout(this.refreshTimer);
    }
    this.$cookies.remove(this.options.accessTokenCookieName);
    this.$cookies.remove(this.options.refreshTokenCookieName);
    await this.$store.commit('auth/SET_USER', null);
    this.$router.push(this.options.loginRoute);
  }

  async refresh() {
    this.refreshTimer = clearTimeout(this.refreshTimer);
    const response = await this.$api.refresh();

    this.$cookies.set(this.options.accessTokenCookieName, response.token);
    this.$cookies.set(this.options.refreshTokenCookieName, response.refresh_token);

    this.refreshTimer = setTimeout(() => {
      this.refresh();
    }, this._getTimeUntilRefreshNeeded(response.token));
    return response.token;
  }

  _getTimeUntilRefreshNeeded(token) {
    const validUntil = jwtDecode(token).exp;
    return validUntil * 1000 - Date.now() - 300000;
  }
}
