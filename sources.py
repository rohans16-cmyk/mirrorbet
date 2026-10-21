"""HTTPS with a working certificate bundle (python.org builds on macOS ship without one)."""
import os
import ssl
import urllib.request


def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    if os.path.exists("/etc/ssl/cert.pem"):
        return ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    return ssl.create_default_context()


SSL = _ssl_context()


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "polyshadow/1.0"})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL) as r:
        return r.read(), dict(r.headers)
