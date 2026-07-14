# Jerarquía de permisos de Claude Code en este setup

Orden real de precedencia (mayor a menor): **managed > local de proyecto (`settings.local.json`) > proyecto (`settings.json`) > usuario (`~/.claude/settings.json`)**. Un `deny` en cualquier nivel gana siempre sobre un `allow` de un nivel inferior.

## Managed (política corporativa)

No aplica. Se verificó que no existe `managed-settings.json` en las rutas donde Claude Code lo busca en Windows (`C:\ProgramData\ClaudeCode\`, variable `CLAUDE_CODE_MANAGED_SETTINGS_PATH` vacía). `C:\ProgramData\Claude` solo contiene logs del servicio de la app de escritorio, no configuración de policy. Este equipo no tiene una organización con política de Claude Code forzada, por lo que este nivel queda vacío y no restringe nada.

## Usuario (`~/.claude/settings.json`)

Solo define tema y plugins (`ponytail`, marketplaces). No trae `permissions`, así que no compite con los niveles de proyecto.

## Proyecto — compartido (`.claude/settings.json`, versionado en el repo)

```json
"deny": ["Git push"],
"ask": ["Rm"]
```
`git push` queda bloqueado para todo el equipo que clona este repo, y `rm` siempre pregunta. Esto se aplicó en la práctica: aunque el nivel local (`settings.local.json`) tiene comandos `Bash(rm ...)` permitidos explícitamente, el `ask` del nivel de proyecto para `Rm` sigue vigente porque no hay un `allow` de mayor precedencia que lo levante (local > proyecto, pero acá local no define `Rm` en `allow`, solo invocaciones puntuales de `rm` con paths fijos que matchean por prefijo, no la categoría genérica).

## Proyecto — local (`.claude/settings.local.json`, no versionado, `.gitignore`)

Permisos ad-hoc acumulados durante el trabajo diario (curl a `localhost:3004`, `node -e`, `npx tsc`, MCP de Huly/browser, etc.). Este archivo es el de mayor precedencia real en este setup porque managed y usuario no tocan `permissions`, así que en la práctica gobierna casi todo salvo el `deny`/`ask` global del `settings.json` de proyecto, que ningún nivel inferior puede levantar.

**Conclusión**: en este repo la jerarquía se manifiesta como proyecto-local > proyecto-compartido > usuario, con managed ausente por no existir política corporativa instalada en la máquina.
