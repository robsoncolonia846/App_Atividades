# Guardar Senhas

Aplicativo web estatico para guardar senhas com criptografia local no navegador.

## Como funciona

- O arquivo `vault.json` guarda apenas dados criptografados (`AES-GCM`).
- A chave e derivada da senha mestra com `PBKDF2` (`SHA-256`, 310000 iteracoes).
- A senha mestra nao e salva em arquivo/servidor; ela fica apenas na sessao da aba para manter login apos atualizar a pagina.
- As alteracoes sao salvas localmente (criptografadas) e podem ser exportadas para atualizar `vault.json` no GitHub.

## Uso local

1. Abra `index.html` no navegador, ou rode um servidor local simples:

```powershell
cd "C:\Users\robson.colonia\OneDrive\03. Programação\App - Guardar Senhas"
python -m http.server 8080
```

2. Acesse `http://localhost:8080`.
3. Crie a senha mestra (na primeira execucao) e adicione suas senhas.
4. Clique em **Exportar JSON** e salve o arquivo na pasta da nuvem.
5. Substitua o `vault.json` do projeto pelo arquivo exportado.
6. Use **Logout** para encerrar a sessao de login.

## Publicar no GitHub Pages

1. Crie um repositorio no GitHub (preferencialmente privado).
2. No PowerShell:

```powershell
cd "C:\Users\robson.colonia\OneDrive\03. Programação\App - Guardar Senhas"
git init
git add .
git commit -m "feat: app Guardar Senhas"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/guardar-senhas.git
git push -u origin main
```

3. No GitHub: Settings -> Pages -> Deploy from branch -> `main` / root.
4. Abra a URL do Pages no celular.

## Fluxo recomendado para sincronizar celular e PC

1. Abra o app, desbloqueie com senha mestra.
2. Edite/adicione senhas.
3. Exporte o novo `vault.json`.
4. Atualize esse arquivo no repositorio e faca commit.
5. No outro dispositivo, recarregue a pagina para baixar a versao mais recente.

## Avisos de seguranca

- Use senha mestra longa e unica.
- Ative 2FA na conta GitHub.
- Nao guarde token GitHub dentro do app.
- Se perder a senha mestra, nao ha recuperacao.
- Este projeto protege o conteudo do arquivo, mas nao protege contra comprometimento total do navegador/dispositivo.
