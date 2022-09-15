import Middleware from '../middleware';

Middleware.auth = function ({ store, redirect, route, $cookies }) {
  const options = JSON.parse(`<%= JSON.stringify(options) %>`);

  const isPublicRoute = routeOption(route, 'auth', 'public');

  if (
    store.state.auth.user &&
    (!$cookies.get(options.refreshTokenCookieName) ||
      !$cookies.get(options.accessTokenCookieName))
  ) {
    $cookies.remove(options.accessTokenCookieName);
    $cookies.remove(options.refreshTokenCookieName);
    store.commit('auth/SET_USER', null);
    if (route.path !== options.loginRoute) {
      return redirect(options.loginRoute);
    }
  }

  if (
    options.hideLoginWhenAuthenticated &&
    route.path === options.loginRoute &&
    store.state.auth.user
  ) {
    return redirect(options.homeRoute);
  }

  // If the user is not authenticated
  if (
    !store.state.auth.user &&
    route.path !== options.loginRoute &&
    route.path !== options.registerRoute &&
    route.path !== options.confirmRoute &&
    route.path !== options.activateRoute &&
    !isPublicRoute
  ) {
    return redirect(options.loginRoute);
  }
};

const routeOption = (route, key, value) => {
  return route.matched.some((m) => {
    if (process.client) {
      // Client
      return Object.values(m.components).some(
        (component) => component.options && component.options[key] === value
      );
    } else {
      // SSR
      return Object.values(m.components).some((component) =>
        Object.values(component._Ctor).some(
          (ctor) => ctor.options && ctor.options[key] === value
        )
      );
    }
  });
};
