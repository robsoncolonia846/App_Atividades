# App de Atividades (PWA)

## Funcionalidades
- Login com Google (Firebase Auth)
- Sincronizacao em nuvem por usuario (Firestore)
- Organizar por data
- Concluir, reagendar e recorrencia
- Painel mensal

## Setup do Firebase
1. Crie um projeto no Firebase.
2. Ative Authentication > Sign-in method > Google.
3. Ative Firestore Database (modo de producao recomendado depois de testar).
4. Em Project settings > General > Your apps (Web), copie as chaves.
5. Preencha o arquivo `firebase-config.js`.

## Regras Firestore (exemplo seguro por usuario)
Use no Firestore Rules:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/state/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Publicacao no GitHub Pages
1. Envie estes arquivos para o repositorio:
- `index.html`
- `styles.css`
- `app.js`
- `manifest.json`
- `firebase-config.js`
2. Em Settings > Pages:
- Source: Deploy from a branch
- Branch: main / (root)

## Uso
- Entre com Google
- Os dados ficam vinculados ao usuario logado
- Sem login, o app funciona localmente no dispositivo
