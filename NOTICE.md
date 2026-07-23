# Third-party notices

## Memex interoperability

LifeOS implements one-way interoperability with the backup data format used by
[memex](https://github.com/memex-lab/memex). It parses ZIP, YAML, and Markdown
data exported by Memex; it does not include Memex source code or link to Memex
at runtime. Memex is an independent project licensed under GPL-3.0.

## UI and runtime dependencies

The application uses open-source dependencies including React, Vite,
Capacitor, Radix UI, shadcn/ui components, Lucide, Recharts, YAML, and yauzl.
Their respective licenses are recorded in the package metadata and lockfiles;
downstream redistributors should preserve those notices when distributing
bundled artifacts.
