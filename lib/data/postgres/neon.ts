import { neonConfig, Pool } from "@neondatabase/serverless";

/**
 * WebSocket Pool Neon: транзакции (оплата регулярных, сверки, CAS) не работают в http-режиме.
 * NEON_WSPROXY=host:port — локальный Postgres за WebSocket-прокси (разработка и проверки), без TLS
 */
export function neonPool(connectionString: string): Pool {
  const proxy = process.env.NEON_WSPROXY;
  if (proxy) {
    neonConfig.wsProxy = (host, port) => `${proxy}/v1?address=${host}:${port}`;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineTLS = false;
    neonConfig.pipelineConnect = false;
  }
  return new Pool({ connectionString });
}
