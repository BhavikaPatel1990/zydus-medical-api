export const success = (res, message = 'Success', data = null, statusCode = 200) => {
  return res.status(statusCode).json({
    status: true,
    message,
    data,
  });
};

export const badRequest = (res, message = 'Bad Request', data = null) => {
  return res.status(400).json({
    status: false,
    message,
    data,
  });
};

export const unauthorized = (res, message = 'Unauthorized') => {
  return res.status(401).json({
    status: false,
    message,
  });
};

export const forbidden = (res, message = 'Forbidden') => {
  return res.status(403).json({
    status: false,
    message,
  });
};

export const notFound = (res, message = 'Resource not found') => {
  return res.status(404).json({
    status: false,
    message,
  });
};

export const serverError = (res, message = 'Internal Server Error', error = null) => {
  if (error) {
    console.error('[API Error]:', error);
  }
  return res.status(500).json({
    status: false,
    message,
    error: typeof error === 'string' ? error : (error?.message || null),
  });
};

export default {
  success,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  serverError,
};
