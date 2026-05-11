<div align="center">
  <h1>Template de Bot de Likes</h1>
  <p><strong>Integração hubsdev.com & MisticPay</strong></p>
</div>

<br>

> *"A tecnologia não é apenas sobre escrever código, é sobre construir infraestruturas que resolvem problemas reais e escalam ideias."*

<br>

<div align="center">
  <a href="https://github.com/hubsqwGG">
    <img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&weight=600&size=20&pause=1000&color=007ACC&center=true&vCenter=true&width=600&lines=Bot+de+Likes+para+Telegram;Integração+hubsdev.com;Pagamentos+MisticPay;Desenvolvido+em+JavaScript" alt="Typing SVG" />
  </a>
</div>

<br>

## Visão Geral

Este template oferece uma solução completa para a criação de um bot de Telegram focado no envio de likes, utilizando a plataforma **hubsdev.com** para a execução dos serviços e a **MisticPay** para a gestão de pagamentos. Projetado para escalabilidade e facilidade de uso, permite que os usuários assinem planos VIP e utilizem funcionalidades exclusivas, enquanto os administradores mantêm controle total sobre o sistema.

---

## Como o Bot Funciona

O fluxo de operação do bot é intuitivo e direto, garantindo uma experiência fluida tanto para usuários quanto para administradores:

1.  **Assinatura de Plano:** Usuários podem adquirir planos VIP através do sistema de pagamentos integrado ou ter o status Premium concedido diretamente por um administrador.
2.  **Liberação de Comando:** Após a ativação do plano, o usuário é autorizado a utilizar o comando `/like <seu_id>` para solicitar o serviço.
3.  **Processamento de Requisição:** O bot realiza uma requisição à API da hubsdev.com, processa o pedido de likes e retorna o resultado ao usuário.

---

## Configuração e Instalação

Para colocar seu bot em funcionamento, siga os passos abaixo:

1.  **Download do Repositório:** Adquira o código-fonte do template.
2.  **Configuração de Variáveis de Ambiente:** Preencha o arquivo `.env` com as credenciais e configurações necessárias, conforme detalhado na seção de **Variáveis de Ambiente**.
3.  **Inicialização:** O projeto é desenvolvido em JavaScript. Após configurar o ambiente, execute `npm start` para iniciar o bot.

**Observação:** Este é um projeto mais antigo e pode requerer pequenas adaptações para compatibilidade com versões mais recentes de dependências ou APIs. No entanto, a estrutura principal e as funcionalidades de venda permanecem operacionais.

---

## Variáveis de Ambiente (.env)

As credenciais e configurações essenciais para o funcionamento do bot são gerenciadas através do arquivo `.env`. Certifique-se de preencher cada campo com as informações corretas:

| Variável | Descrição | Exemplo | 
| :--- | :--- | :--- |
| `BOT_TOKEN` | Token do seu bot do Telegram, obtido via BotFather. | `SEU_TOKEN_BOT_TELEGRAM` |
| `DOMAIN_HUBS` | URL da API de envio de likes da HubsDev. | `https://hubsdev.com/api/frifas/sendlikes` |
| `CHAVE_HUBS` | Sua chave de acesso à API da HubsDev. | `SUA_CHAVE_HUBS` |
| `LIST_OWNERS` | Lista de IDs de usuários do Telegram que serão considerados donos do bot, separados por vírgula. | `7906852494,8300218617` |
| `PAYMENT_API_URL` | URL base da API da MisticPay. | `https://api.misticpay.com/api` |
| `PAYMENT_CLIENT_ID` | ID do cliente MisticPay para autenticação. | `MISTICPAY_ID` |
| `PAYMENT_CLIENT_SECRET` | Chave secreta do cliente MisticPay para autenticação. | `MISTICPAY_CLIENT` |
| `PAYER_NAME` | Nome do pagador para transações MisticPay. | `SEU_NOME_AQUI` |
| `PAYER_DOCUMENT` | CPF do pagador para transações MisticPay. | `SEU_CPF_AQUI` |
| `BUTTON_TEXT` | Texto exibido no botão inline de comunidade. | `Comunidade Hubs` |
| `BUTTON_URL` | URL de destino do botão inline de comunidade. | `https://t.me/hubsqwGG` |
| `LIKES_REGIONS` | Regiões disponíveis para o serviço de likes, no formato `código|nome,código|nome`. | `br|Brasil,ind|Indonésia` |

<br>

<details>
  <summary><strong>Visualizar Badges de Tecnologia</strong></summary>
  <br>
  <p align="center">
    <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript" />
    <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
    <img src="https://img.shields.io/badge/NPM-CB3837?style=for-the-badge&logo=npm&logoColor=white" alt="NPM" />
  </p>
</details>

---

## Comandos do Bot

O bot oferece uma série de comandos para interação de usuários e gerenciamento por parte dos donos:

| Comando | Descrição | Acesso | 
| :--- | :--- | :--- |
| `/start` | Abre o menu principal do bot. | Todos |
| `/like {id}` | Envia likes para um ID específico, solicitando a região. | VIP ou Admin |
| `/addvip {id}` | Abre o menu de planos para adicionar status VIP a um usuário. | Apenas Donos |
| `/delvip {id}` | Remove o status VIP de um usuário. | Apenas Donos |
| `/checkvip {id}` | Consulta o status VIP de um usuário. | Apenas Donos |
| `/block {id} {motivo}` | Bloqueia um usuário do bot, com motivo opcional. | Apenas Donos |
| `/desblock {id}` | Desbloqueia um usuário. | Apenas Donos |
| `/not {mensagem}` | Envia uma mensagem em massa para todos os usuários do bot. | Apenas Donos |
| `/stats` | Exibe estatísticas gerais de uso do bot. | Apenas Donos |

---

## Funcionamento Interno do Sistema

### VIP e Gerenciamento de Usuários

Os dados dos usuários são armazenados automaticamente em um arquivo `users.json` (localizado em `banco-dados/banco-json/`). Cada registro de usuário inclui campos como `vip` (booleano), `vipExpires` (timestamp de expiração), `vipLimit` (limite diário de usos) e `vipUsed` (contagem de usos no dia atual). Ao tentar usar o comando `/like`, o bot verifica o status do usuário:

*   **Admin:** Acesso irrestrito.
*   **VIP:** Acesso permitido, respeitando o limite diário de usos.
*   **Usuário Comum:** Sem acesso à funcionalidade de likes.

### Sistema de Pagamentos (MisticPay)

O bot integra-se à API da MisticPay para processar pagamentos via Pix. Quando um usuário seleciona a opção "EXIBIR PLANOS", os planos disponíveis (3, 15, 30 e 60 dias) são carregados do arquivo `payment.js`. Ao escolher um plano, o bot gera uma cobrança e monitora seu status a cada 5 segundos por até 20 minutos. Uma vez que o pagamento é aprovado, o status VIP do usuário é ativado automaticamente, adicionando os dias do plano à sua expiração atual.

### Configuração de Regiões

As regiões para o serviço de likes são definidas na variável de ambiente `LIKES_REGIONS` no arquivo `.env`. O formato esperado é `código|nome,código|nome`. Ao utilizar o comando `/like`, o bot apresenta botões inline para que o usuário selecione a região desejada para o envio dos likes.

### Fila de Processamento de Likes

Para garantir a estabilidade e evitar sobrecarga, os pedidos de likes são gerenciados por uma fila. Esta fila processa um máximo de 5 requisições simultaneamente, com um *timeout* de 45 segundos para cada. Pedidos que permanecem na fila por mais de 60 segundos são automaticamente removidos para evitar atrasos excessivos.

---

<div align="center">
  <small><i>Arquitetado e mantido por hubsqwGG</i></small>
</div>
