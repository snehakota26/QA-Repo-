const test = require('node:test');
const assert = require('node:assert/strict');
const { base32Decode, generateHotp } = require('../specs/support/totp');

test('base32Decode matches RFC 4648 test vectors', () => {
  assert.equal(base32Decode('MY======').toString('utf8'), 'f');
  assert.equal(base32Decode('MZXQ====').toString('utf8'), 'fo');
  assert.equal(base32Decode('MZXW6===').toString('utf8'), 'foo');
  assert.equal(base32Decode('MZXW6YQ=').toString('utf8'), 'foob');
  assert.equal(base32Decode('MZXW6YTBOI======').toString('utf8'), 'foobar');
});

test('generateHotp matches RFC 4226 Appendix D test vectors', () => {
  const key = Buffer.from('12345678901234567890', 'ascii');
  const expectedCodes = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489'
  ];
  expectedCodes.forEach((code, counter) => {
    assert.equal(generateHotp(key, counter), code);
  });
});
