"""Validate Cloudflare Access JWTs using the team's rotating public signing keys."""

from urllib.parse import urlsplit

import jwt
from jwt import PyJWKClient


class AccessTokenVerifier:
    """Fail closed on missing, expired, unsigned or wrongly scoped assertions."""

    def __init__(self, team_domain: str, audience: str):
        parsed = urlsplit(team_domain)
        if (parsed.scheme != "https" or not parsed.hostname
                or not parsed.hostname.endswith(".cloudflareaccess.com")
                or parsed.username or parsed.password or parsed.port
                or parsed.path or parsed.query or parsed.fragment
                or not audience or any(c.isspace() for c in audience)):
            raise ValueError("Invalid Cloudflare Access team domain or audience")
        self.issuer = f"https://{parsed.hostname}"
        self.audience = audience
        self.jwks = PyJWKClient(f"{self.issuer}/cdn-cgi/access/certs", cache_jwk_set=True,
                                lifespan=300, timeout=5)

    def __call__(self, assertion: str) -> bool:
        if not assertion or len(assertion) > 16384:
            return False
        try:
            key = self.jwks.get_signing_key_from_jwt(assertion).key
            jwt.decode(assertion, key, algorithms=["RS256"],
                       issuer=self.issuer, audience=self.audience,
                       options={"require": ["iss", "aud", "exp", "iat"]}, leeway=10)
            return True
        except (jwt.PyJWTError, OSError, ValueError, TypeError):
            return False
