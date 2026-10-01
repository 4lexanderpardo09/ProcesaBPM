# ProcesaBPM

SaaS multi-tenant de gestión de procesos (BPM ligero): flujos visuales con aprobaciones, formularios dinámicos, SLA en horas o días hábiles por empresa, documentos PDF y reportes de desempeño.

Nace de extraer la lógica del sistema de gestión (mesa de ayuda) de Electrocréditos del Cauca (`~/dev/mesa-de-ayuda`), sin los módulos de viáticos, ventas ni listas de precios. Electrocréditos **no** se migra; sigue con su versión.

## Estado
En construcción. **Hecho:** la base de datos (`packages/db`), la lógica compartida inicial (`packages/shared`) y en `apps/api` el acceso a datos por tenant, la autenticación y la autorización (CASL). **Siguiente:** los módulos de negocio. Detalle en [docs/pendientes.md](docs/pendientes.md).

## Documentos
- [docs/analisis.md](docs/analisis.md): análisis del sistema original (lógica, BD, bugs), decisiones tomadas (§0.1) y diseño propuesto (multi-tenant, archivos, SLA, aprobadores, despliegue, constructor de flujos).
- [docs/base-de-datos.md](docs/base-de-datos.md): **referencia de la BD**: modelo, aislamiento, reglas de integridad, contrato para el API, pruebas, cambios y despliegue.
- [docs/revision-bd.md](docs/revision-bd.md): registro de la revisión de integridad (aplicada).
- [docs/arquitectura.md](docs/arquitectura.md): organización de carpetas del back, el front y el código compartido.
- [docs/pendientes.md](docs/pendientes.md): qué falta por definir y el alcance propuesto para v1/v2.

## Stack decidido
NestJS + Prisma + PostgreSQL (una BD compartida con `tenant_id` + RLS) · React + Vite + React Flow · Redis (colas BullMQ) · almacenamiento S3-compatible (MinIO en desarrollo) · imágenes Docker.

## Empezar
```bash
pnpm install
cd packages/db && pnpm test   # requiere Docker
```
