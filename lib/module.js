const { resolve, join } = require('path');

export default function (moduleOptions) {
  const options = Object.assign(
    {
      accessTokenCookieName: 'access_token',
      refreshTokenCookieName: 'refresh_token',
      loginRoute: '/login',
      confirmRoute: '/confirm',
      registerRoute: '/register',
      activateRoute: '/activate',
      homeRoute: '/',
      accessTokenEndpoint: '/authentication_token',
      registerAdminEndpoint: '/register_admin',
      registerUserEndpoint: '/register_user',
      refreshTokenEndpoint: '/token_refresh',
      hideLoginWhenAuthenticated: true,
      usersEntity: 'users',
      accessTokenUserIdKey: 'userId',
      minioApi: null,
      minioUser: 'minio',
      minioPassword: 'minio123',
      minioBucket: 'media',
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
