const { resolve, join } = require('path');

export default function (moduleOptions) {
  const options = Object.assign(
    {
      accessTokenCookieName: 'access_token',
      refreshTokenCookieName: 'refresh_token',
      loginRoute: '/login',
      homeRoute: '/',
      accessTokenEndpoint: '/authentication_token',
      refreshTokenEndpoint: '/token_refresh',
      hideLoginWhenAuthenticated: true,
    },
    this.options.apiPlatform,
    moduleOptions
  );

  const pluginsToSync = ['plugin.js', 'middleware.js', 'api.js'];
  for (const pathString of pluginsToSync) {
    this.addPlugin({
      src: resolve(__dirname, pathString),
      fileName: join('api-platform', pathString),
      options,
    });
  }
}
module.exports.meta = require('../package.json');
