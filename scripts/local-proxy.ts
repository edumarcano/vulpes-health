import { createLogger, type ProxyOptions } from 'vite';
import { sendError } from '../server/http/responses.js';

const logger = createLogger();
export const localLogger = {
  ...logger,
  error(message: string, options?: Parameters<typeof logger.error>[1]): void {
    if (message.includes('http proxy error:'))
      logger.error('Local API connection failed.');
    else logger.error(message, options);
  },
};

export const apiProxy: ProxyOptions = {
  target: 'http://127.0.0.1:3001',
  configure(proxy) {
    proxy.on('error', (_error, _request, response) => {
      if (
        'writeHead' in response &&
        !response.headersSent &&
        !response.writableEnded
      ) {
        sendError(
          response,
          503,
          'api_unavailable',
          'The local API could not be reached.',
        );
      }
    });
  },
};
