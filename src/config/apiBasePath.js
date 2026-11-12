export const getApiBasePath = () => {
  const path = process.env.API_BASE_PATH || '/zydus-medical-api';
  return `/${String(path).split('/').filter(Boolean).join('/')}`;
};
