# Security notes

LifeOS is designed for local or trusted-LAN use. The development server binds
to all interfaces so the Android client and other devices on the same LAN can
connect. The current LAN mode has no authentication and exposes state and
debugging APIs to anyone who can reach the port.

Use it only on a trusted private network, keep the host firewall enabled, and
never port-forward the server to the public Internet. Treat imported backups,
chat content, memory files, and configured LLM credentials as sensitive.

If you find a security issue, do not include personal data or API keys in a
public issue. Contact the maintainer privately first.
