# App de Atividades (PWA)

## Funcionalidades
- Organizar atividades por data.
- Marcar concluida com 1 clique.
- Recorrencia diaria, semanal e mensal.
- Agrupamento: em aberto, concluidas e excluidas.
- Painel mensal com numeracao das atividades.
- Sincronizacao em arquivo JSON escolhido pelo usuario.

## Sincronizacao JSON
1. Abra o app.
2. Clique em `Sincronizar JSON`.
3. Escolha onde fica o arquivo base (`.json`), local ou nuvem (ex.: OneDrive).
4. Depois disso, toda alteracao passa a ser salva automaticamente nesse arquivo.

Observacao:
- Em navegadores sem suporte de gravacao direta em arquivo, o app permite importacao do JSON e continua salvando localmente.

## Publicacao no GitHub Pages
1. Envie estes arquivos para o repositorio:
- `index.html`
- `styles.css`
- `app.js`
- `manifest.json`
2. Em Settings > Pages:
- Source: Deploy from a branch
- Branch: `main` / `(root)`
