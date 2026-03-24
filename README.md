# App de Atividades (PWA)

## Funcionalidades
- Criar e editar atividades com data.
- Marcar como concluida com 1 clique.
- Recorrencia diaria, semanal e mensal.
- Agrupar atividades em aberto por periodo.
- Ver painel mensal com numeracao das atividades.

## Armazenamento
- Modo local (`localStorage`) sempre ativo.
- Botao `Importar JSON` para carregar uma base existente.
- Botao `Exportar JSON` para gerar backup manual.
- Sem login.

## Observacao importante
- O app funciona no navegador mesmo sem permissao de pasta/arquivo.
- Para manter historico entre dispositivos, exporte e importe o JSON manualmente.

## Publicacao no GitHub Pages
1. Envie:
- `index.html`
- `styles.css`
- `app.js`
- `manifest.json`
- `README.md`
2. Em `Settings > Pages`:
- Source: `Deploy from a branch`
- Branch: `main / (root)`
