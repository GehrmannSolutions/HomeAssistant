"""Cloudflare Access assertions must be verified cryptographically at the origin."""
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from ha_safe_mcp.access_auth import AccessTokenVerifier

ISS = 'https://team.cloudflareaccess.com'
AUD = 'app-audience-tag'


@pytest.fixture
def signed_assertion():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key(), as_dict=True)
    public.update({'kid': 'key-1', 'use': 'sig', 'alg': 'RS256'})
    now = datetime.now(timezone.utc)

    def make(**overrides):
        claims = {'iss': ISS, 'aud': [AUD], 'sub': 'user', 'iat': now,
                  'exp': now + timedelta(minutes=5)}
        claims.update(overrides)
        return jwt.encode(claims, private, algorithm='RS256', headers={'kid': 'key-1'})

    return make, {'keys': [public]}


def test_valid_cloudflare_jwt_is_accepted(signed_assertion):
    make, jwks = signed_assertion
    verifier = AccessTokenVerifier(ISS, AUD)
    verifier.jwks.fetch_data = lambda: jwks
    assert verifier(make()) is True


@pytest.mark.parametrize('change', [
    {'aud': ['another-app']}, {'iss': 'https://attacker.example'},
    {'exp': datetime(2020, 1, 1, tzinfo=timezone.utc)},
    {'iss': ''}, {'aud': []},
])
def test_bad_claims_fail_closed(signed_assertion, change):
    make, jwks = signed_assertion
    verifier = AccessTokenVerifier(ISS, AUD)
    verifier.jwks.fetch_data = lambda: jwks
    assert verifier(make(**change)) is False


def test_bad_signature_or_jwks_failure_fail_closed(signed_assertion):
    make, jwks = signed_assertion
    verifier = AccessTokenVerifier(ISS, AUD)
    verifier.jwks.fetch_data = lambda: jwks
    parts = make().split('.')
    last = parts[-1]
    parts[-1] = ('A' if last[0] != 'A' else 'B') + last[1:]
    assert verifier('.'.join(parts)) is False
    assert verifier('not-a-jwt') is False
    offline = AccessTokenVerifier(ISS, AUD)
    offline.jwks.fetch_data = lambda: (_ for _ in ()).throw(OSError('network down'))
    assert offline(make()) is False


def test_rejects_non_https_or_unexpected_team_domain():
    for domain in ('http://team.cloudflareaccess.com', 'https://evil.example',
                   'https://team.cloudflareaccess.com/extra'):
        with pytest.raises(ValueError):
            AccessTokenVerifier(domain, AUD)
