'use strict';

const common = require('../common');
if (!common.hasQuic)
  common.skip('missing quic');

const { createSocket } = require('quic');
const fixtures = require('../common/fixtures');
const Countdown = require('../common/countdown');
const key = fixtures.readKey('agent1-key.pem', 'binary');
const cert = fixtures.readKey('agent1-cert.pem', 'binary');
const ca = fixtures.readKey('ca1-cert.pem', 'binary');

const kServerName = 'agent2';
const kALPN = 'zzz';
const kIdleTimeout = 0;
const kConnections = 5;

// After QuicSocket bound, the callback of QuicSocket.connect()
// should still get called.
{
  let client;
  const server = createSocket({
    port: 0,
  });

  server.listen({
    key,
    cert,
    ca,
    alpn: kALPN,
    idleTimeout: kIdleTimeout,
  });

  const countdown = new Countdown(kConnections, () => {
    client.close();
    server.close();
  });

  server.on('ready', common.mustCall(() => {
    const options = {
      key,
      cert,
      ca,
      address: common.localhostIPv4,
      port: server.address.port,
      servername: kServerName,
      alpn: kALPN,
      idleTimeout: kIdleTimeout,
    };

    client = createSocket({
      port: 0,
    });

    const session = client.connect(options, common.mustCall(() => {
      session.close(common.mustCall(() => {
        // After a session being ready, the socket should have bound
        // and we could start the test.
        testConnections();
      }));
    }));

    const testConnections = common.mustCall(() => {
      for (let i = 0; i < kConnections; i += 1) {
        client.connect(options, common.mustCall(() => {
          countdown.dec();
        }));
      }
    });
  }));
}
