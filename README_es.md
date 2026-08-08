# Applesauce

<!-- hy-mt2-i18n:start -->
[English](./README.md) | [中文](./README_zh-CN.md) | [日本語](./README_ja.md) | **Español**
<!-- hy-mt2-i18n:end -->


Applesauce es una colección de bibliotecas en TypeScript que facilita la creación de clientes web para Nostr y se utiliza en [noStrudel](https://github.com/hzrd149/nostrudel).

La documentación completa se puede encontrar en el sitio [documentation](https://hzrd149.github.io/applesauce).

## Instalación

```bash
# usando npm
npm install applesauce-core
# usando pnpm
pnpm install applesauce-core
# usando yarn
yarn add applesauce-core
```

## Configuración de desarrollo

Clona el repositorio:

```bash
git clone https://github.com/hzrd149/applesauce.git
cd applesauce
```

Instala las dependencias:

```bash
pnpm install
```

Construye el proyecto:

```bash
pnpm build
```

## Ejecución de pruebas

Este repositorio utiliza [vitest](https://vitest.dev/) para todas las pruebas.

```bash
# Ejecutar todas las pruebas
pnpm test
# Ejecutar pruebas de cobertura
pnpm coverage
# Ejecutar las pruebas en modo de desarrollo
pnpm vitest
```

## Ejecución de la documentación

Este repositorio está configurado con [typedoc](https://typedoc.org/) para la documentación en TypeScript y [vitepress](https://vitepress.dev/) para el sitio de documentación.

```bash
# Construir los documentos tipo Typedoc
pnpm typedoc
```

El paquete `apps/docs` sirve para el sitio de documentación.

```bash
cd apps/docs

# Ejecutar VitePress en modo desarrollo
pnpm dev

# Construir VitePress
pnpm build
```

## React

El paquete `applesauce-react` contiene varios ganchos y proveedores para utilizar Applesauce en componentes React. [Documentación](https://applesauce.build/react/getting-started.html)

## Agentes de IA (Servidor MCP)

La herramienta `applesauce-mcp` ofrece búsquedas semánticas en la documentación y ejemplos de código de Applesauce para agentes de IA a través del Model Context Protocol. Esto ayuda a los asistentes de IA a crear aplicaciones Nostr con un uso preciso de las API y patrones reales del mundo.

**Inicio rápido:** Conéctate al servidor público en `https://mcp.applesauce.build/mcp` desde tu IDE impulsado por IA (OpenCode, Cursor, Claude Desktop, etc.).

[Documentación completa](https://applesauce.build/introduction/agents.html) | [Código fuente](https://github.com/hzrd149/applesauce-mcp)

## Contribuciones

1. Clona el repositorio.
2. Crea tu rama de características: `git checkout -b feature/my-new-feature`.
3. Instala las dependencias: `pnpm install`.
4. Realiza tus cambios.
5. Ejecuta las pruebas: `pnpm test`.
6. Construye el proyecto: `pnpm build`.
7. Formatea el código: `pnpm format`.
8. Guarda tus cambios: `git commit -am 'Agregar alguna función nueva'`.
9. Envía los cambios a la rama: `git push origin feature/my-new-feature`.
10. Envía una solicitud de fusión.
