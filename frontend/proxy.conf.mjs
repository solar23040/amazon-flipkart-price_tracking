// Dev-server proxy: the app always calls /api and this forwards it to the backend.
// Override the target when the backend is not on the default port:
//   API_PROXY_TARGET=http://localhost:4000 npm start
const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default {
  '/api': {
    target,
    changeOrigin: true,
    secure: false,
  },
};
