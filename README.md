# App de Atividades (PWA)

App simples para celular com:
- criar atividade com data;
- marcar como concluída (desce para o fim da lista);
- recorrência (diária, semanal, mensal);
- reativar tarefa recorrente para próxima data;
- adiar tarefa (`+1 dia`).

## Como testar no PC
1. Abra a pasta `todo-mobile-pwa`.
2. Clique duas vezes em `index.html`.

## Como usar no celular (mesma rede Wi-Fi)
1. No PC, abra terminal na pasta `todo-mobile-pwa`.
2. Rode:

```bash
python -m http.server 8080
```

3. Descubra o IP do PC (ex.: `192.168.0.15`).
4. No celular, abra: `http://SEU_IP:8080`.
5. No navegador do celular, use "Adicionar à tela inicial" para instalar como app.

## Regras implementadas
- Tarefa não recorrente:
  - `Concluir` marca como concluída e joga para baixo.
  - `Reativar` volta para ativa.
- Tarefa recorrente:
  - `Concluir` marca como concluída e calcula próxima data.
  - `Reativar` traz de volta como ativa já na próxima data.
  - `+1 dia` adia a data atual (ou próxima data, se já estiver concluída).
