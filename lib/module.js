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

  const templatesToSync = [
    'api/items.js',
    'api/preProcessors/index.js',
    'api/preProcessors/mediaObject.js',
  ];
  for (const pathString of templatesToSync) {
    this.addTemplate({
      src: resolve(__dirname, pathString),
      fileName: join('api-platform', pathString),
    });
  }

  const pluginsToSync = ['plugin.js', 'middleware.js', 'api/index.js'];
  for (const pathString of pluginsToSync) {
    this.addPlugin({
      src: resolve(__dirname, pathString),
      fileName: join('api-platform', pathString),
      options,
    });
  }
}
module.exports.meta = require('../package.json');
