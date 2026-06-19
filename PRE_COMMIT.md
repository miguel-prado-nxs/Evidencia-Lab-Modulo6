# Pre-Commit Quality Gates

Este repositorio usa **Husky** + **lint-staged** para verificar automáticamente la calidad del código en cada `git commit`. Los checks corren únicamente sobre los archivos que estás por commitear — no sobre todo el proyecto.

## Qué pasa cuando haces `git commit`

Se ejecutan 3 validaciones en secuencia sobre los archivos `src/**/*.js` que tengas en el staging area:

| # | Herramienta | Qué verifica | Falla si... |
|---|-------------|--------------|-------------|
| 1 | **ESLint** | Errores de código (no auto-corrige) | Hay errores de lint (`var`, `eqeqeq`, bugs reales, etc.) |
| 2 | **Prettier** | Formato del código | El archivo no está formateado correctamente |
| 3 | **Secretlint** | Credenciales hardcodeadas | Encuentra API keys, tokens o secrets en el código |

Si cualquiera de los 3 falla, **el commit es bloqueado** y se muestra el error con archivo y número de línea. El código en el repo no cambia.

## Primeros pasos (clonar el repo)

Al hacer `npm install`, Husky se activa automáticamente via el script `prepare`. No necesitas hacer nada adicional.

```bash
git clone <repo>
cd easyorder-partners-api
npm install   # ← el hook queda instalado automáticamente
```

## Cuando el commit falla

### Error de lint

```
✖ eslint --no-fix:
src/services/myService.js
  12:3  error  Unexpected var, use let or const instead  no-var
```

**Solución:** Corrige el error manualmente y vuelve a hacer `git add` + `git commit`.

Para auto-corregir errores de lint (donde sea posible):
```bash
npm run lint:fix
```

### Error de formato

```
✖ prettier --check:
[warn] src/services/myService.js
[warn] Code style issues found. Run Prettier with --write to fix.
```

**Solución:** Formatea el archivo y re-stagea:
```bash
npm run format              # formatea todo src/
# o solo el archivo específico:
npx prettier --write src/services/myService.js
git add src/services/myService.js
```

### Error de credenciales

```
✖ secretlint:
src/config/myConfig.js
  5:6  error  [AWSSecretAccessKey] found AWS Secret Access Key
```

**Solución:** Mueve el valor a una variable de entorno en `.env` y referenciala via `config/env.js`. Nunca hardcodees secrets en el código.

## Ejecutar los checks manualmente

Sin necesidad de hacer un commit, puedes correr cada check por separado:

```bash
npm run lint           # ESLint en todo src/ (solo reporta, no corrige)
npm run lint:fix       # ESLint con auto-corrección
npm run format:check   # Prettier en modo verificación
npm run format         # Prettier con auto-formato
npm run secrets:check  # Secretlint en todo src/
```

Para verificar todo de una vez (equivalente a lo que corre en CI):

```bash
npm run lint && npm run format:check && npm run secrets:check
```

## Verificar que los gates funcionan

Puedes probar cada gate manualmente con estos archivos de prueba. Recuerda limpiar después de cada uno.

### Gate 1 — Lint

```powershell
# 1. Crea el archivo
@"
'use strict';

var x = 1;
console.log(x);
"@ | Out-File src/_test_lint.js -Encoding utf8

# 2. Stagea e intenta commitear — debe fallar con error no-var
git add src/_test_lint.js
git commit -m "test: lint gate"

# 3. Limpia
git restore --staged src/_test_lint.js
Remove-Item src/_test_lint.js
```

Resultado esperado:
```
✖ eslint --no-fix:
src/_test_lint.js
  3:1  error  Unexpected var, use let or const instead  no-var
husky - pre-commit script failed (code 1)
```

### Gate 2 — Formato

```powershell
# 1. Crea el archivo con 4 espacios de indentación (Prettier espera 2)
@"
'use strict';

const x = 1;
if (x) {
    console.log(x);
}
"@ | Out-File src/_test_format.js -Encoding utf8

# 2. Stagea e intenta commitear — debe fallar con error de Prettier
git add src/_test_format.js
git commit -m "test: format gate"

# 3. Limpia
git restore --staged src/_test_format.js
Remove-Item src/_test_format.js
```

Resultado esperado:
```
✖ prettier --check:
[warn] src/_test_format.js
[warn] Code style issues found. Run Prettier with --write to fix.
husky - pre-commit script failed (code 1)
```

### Gate 3 — Secrets

```powershell
# 1. Crea el archivo con un secret hardcodeado
@"
'use strict';

const AWS_SECRET_ACCESS_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD';
console.log(AWS_SECRET_ACCESS_KEY);
"@ | Out-File src/_test_secret.js -Encoding utf8

# 2. Formatea primero (para que solo falle Secretlint y no Prettier)
npx prettier --write src/_test_secret.js

# 3. Stagea e intenta commitear — debe fallar con error de Secretlint
git add src/_test_secret.js
git commit -m "test: secrets gate"

# 4. Limpia
git restore --staged src/_test_secret.js
Remove-Item src/_test_secret.js
```

Resultado esperado:
```
✖ secretlint:
  error  [AWSSecretAccessKey] found AWS Secret Access Key
husky - pre-commit script failed (code 1)
```

> **Nota:** El key de ejemplo oficial de AWS (`AKIAIOSFODNN7EXAMPLE`) está en la lista de ignorados de Secretlint. El test usa un key con el patrón `AWS_SECRET_ACCESS_KEY = '...'` que sí es detectado.

## Archivos de configuración

| Archivo | Propósito |
|---------|-----------|
| `.husky/pre-commit` | Script del hook — llama a lint-staged |
| `eslint.config.js` | Reglas de ESLint (flat config v10) |
| `.prettierrc.json` | Configuración de Prettier |
| `.prettierignore` | Archivos que Prettier ignora |
| `.secretlintrc.json` | Reglas de detección de credenciales |
| `package.json` → `lint-staged` | Qué checks corren sobre qué archivos |

## Bypass de emergencia (usar con cuidado)

Si necesitas saltarte el hook en una situación excepcional:

```bash
git commit --no-verify -m "mensaje"
```

> **No uses esto regularmente.** El hook existe para proteger la calidad del código compartido. Úsalo solo cuando el check falla por un falso positivo confirmado y no hay tiempo de resolverlo en el momento.

## Reglas de ESLint activas

Las más importantes que pueden causar fallos:

| Regla | Qué significa |
|-------|---------------|
| `no-var` | Usar `const` o `let` en lugar de `var` |
| `prefer-const` | Usar `const` si la variable no se reasigna |
| `eqeqeq` | Usar `===` en lugar de `==` (excepto con `null`) |
| `no-unused-vars` | Variables declaradas pero nunca usadas |
| `no-prototype-builtins` | Usar `Object.hasOwn()` en lugar de `.hasOwnProperty()` |
| `preserve-caught-error` | Pasar el error capturado como `cause` al relanzar |
