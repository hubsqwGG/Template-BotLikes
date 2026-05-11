const messages = {
  userBlocked: (chatId, messageId, userId, blockedInfo) => {
    const username = blockedInfo && blockedInfo.username ? `@${blockedInfo.username}` : 'Não disponível';
    const adminId = blockedInfo && blockedInfo.blockedBy ? blockedInfo.blockedBy : 'Sistema';
    const blockDate = blockedInfo && blockedInfo.blockedDate ? blockedInfo.blockedDate : new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const reason = blockedInfo && blockedInfo.reason ? blockedInfo.reason : 'Não especificado';

    return {
      text: `<b><u>🚫 | ACESSO BLOQUEADO!</u></b>\n\n` +
        `<blockquote><b> → Informações do banimento:</b>\n` +
        `<b> ↳ UserId:</b> <code>${userId}</code> — ${username}\n` +
        `<b> ↳ Banido desde:</b> <code>${blockDate}</code>\n` +
        `<b> ↳ Admin responsável:</b> <code>${adminId}</code>\n` +
        `<b> ↳ Motivo:</b> <code>${reason}</code>\n` +
        `<b> ↳ Suporte:</b> Entre em contato conosco.</blockquote>\n\n` +
        `<b><u>☠️ | Regras existem. Você escolheu ignorá-las.</u></b>`,
      options: {
        parse_mode: 'HTML',
        reply_to_message_id: messageId,
        reply_markup: {
          inline_keyboard: [[
            { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
          ]]
        }
      }
    };
  },

  vipOnly: (chatId, userId, messageId) => ({
    text: `<b><u>🙂‍↔️ | ACESSO NEGADO — PLANO INATIVO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes do ocorrido:</b>\n` +
      `<b> ↳ Seu ID:</b> <code>${userId}</code>\n` +
      `<b> ↳ Motivo:</b> <code>Nenhum plano ativo no momento</code>\n` +
      `<b> ↳ Ação disponível:</b> <code>Upgrade para VIP Individual</code></blockquote>\n\n` +
      `<b><u>🙀 | Adquira o plano clicando no botão abaixo.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: "💸 | EXIBIR PLANOS", callback_data: `show_plans_${userId}` }
        ]]
      }
    }
  }),

  paymentGenerated: (chatId, messageId, userId, plan, copyPasteCode) => ({
    text: `<b><u>✨ | PAGAMENTO GERADO COM SUCESSO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes do plano selecionado:</b>\n` +
      `<b> ↳ Plano:</b> <code>${plan.nome}</code>\n` +
      `<b> ↳ Valor:</b> <code>R$ ${plan.valor.toFixed(2)}</code>\n` +
      `<b> ↳ Limite diário:</b> <code>${plan.limite} usos</code>\n` +
      `<b> ↳ Duração:</b> <code>${plan.dias} dias</code>\n` +
      `<b> ↳ Código Pix:</b></blockquote>\n` +
      `<code>${copyPasteCode}</code>\n\n` +
      `<b><u>⏳ | Aguardando aprovação do pagamento...</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: "❌ | CANCELAR PAGAMENTO", callback_data: `cancel_payment_${userId}` }
        ]]
      }
    }
  }),

  paymentSuccess: (chatId, messageId, userId, plan, vipTimes) => {
    const vezesCompra = vipTimes === 1 ? "1°" : vipTimes === 2 ? "2°" : vipTimes === 3 ? "3°" : `${vipTimes}°`;

    return {
      text: `<b><u>💵 | PAGAMENTO APROVADO COM SUCESSO!</u></b>\n\n` +
        `<blockquote><b> → Detalhes do seu pedido:</b>\n` +
        `<b> ↳ Plano ativado:</b> <code>${plan.nome}</code>\n` +
        `<b> ↳ Dias no total:</b> <code>${plan.dias} dias</code>\n` +
        `<b> ↳ Limite diário:</b> <code>${plan.limite} usos</code>\n` +
        `<b> ↳ Valor pago:</b> <code>R$ ${plan.valor.toFixed(2)}</code>\n` +
        `<b> ↳ Compra nº:</b> <code>${vezesCompra} no sistema</code></blockquote>\n\n` +
        `<b><u>🎉 | Parabéns! Seu acesso VIP está ativo.</u></b>`,
      options: {
        parse_mode: 'HTML',
        reply_to_message_id: messageId,
        reply_markup: {
          inline_keyboard: [[
            { text: "🔄 | VOLTAR AO MENU", callback_data: `mp_${userId}` }
          ]]
        }
      }
    };
  },

  adminVipAdded: (chatId, messageId, targetUserId, plan) => ({
    text: `<b><u>🎉 | VIP ADICIONADO COM SUCESSO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes da ativação:</b>\n` +
      `<b> ↳ UserId:</b> <code>${targetUserId}</code>\n` +
      `<b> ↳ Plano:</b> <code>${plan.nome}</code>\n` +
      `<b> ↳ Dias:</b> <code>${plan.dias} dias</code>\n` +
      `<b> ↳ Limite diário:</b> <code>${plan.limite} usos</code></blockquote>\n\n` +
      `<b><u>👑 | VIP ativado por administrador.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  vipLimitReached: (chatId, messageId, limit, used) => ({
    text: `<b><u>🫧 | LIMITE DIÁRIO ESGOTADO!</u></b>\n\n` +
      `<blockquote><b> → Informações do seu plano:</b>\n` +
      `<b> ↳ Limite diário:</b> <code>${limit} usos</code>\n` +
      `<b> ↳ Usado hoje:</b> <code>${used} usos</code>\n` +
      `<b> ↳ Status:</b> <code>Esgotado por hoje</code></blockquote>\n\n` +
      `<b><u>🦠 | Tente novamente amanhã!</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  queueFull: (chatId, messageId) => ({
    text: `<b><u>🚧 | FILA DE PROCESSAMENTO LOTADA!</u></b>\n\n` +
      `<blockquote><b> → Status atual do servidor:</b>\n` +
      `<b> ↳ Situação:</b> <code>Capacidade máxima atingida</code>\n` +
      `<b> ↳ Ação:</b> <code>Aguarde um pedido ser concluído</code></blockquote>\n\n` +
      `<b><u>⏳ | Tente novamente em alguns minutos.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  requestReceived: (chatId, messageId, uid, regionName, userLimit, position, queueSize, username, totalRequests) => ({
    text: `<b><u>🌩️ | PEDIDO RECEBIDO COM SUCESSO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes do processamento:</b>\n` +
      `<b> ↳ ContaId:</b> <code>${uid}</code>\n` +
      `<b> ↳ Região:</b> <code>${regionName}</code>\n` +
      `<b> ↳ Seu limite:</b> <code>${userLimit}</code>\n` +
      `<b> ↳ Posição na fila:</b> <code>${position}° lugar</code>\n` +
      `<b> ↳ Total na espera:</b> <code>${queueSize} usuário${queueSize !== 1 ? 's' : ''}</code>\n` +
      `<b> ↳ Username:</b> ${username ? '@' + username : 'Sem username'}\n` +
      `<b> ↳ Total de pedidos:</b> <code>${totalRequests} pedidos</code></blockquote>\n\n` +
      `<b><u>⌛ | Aguarde a conclusão para ver os resultados.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  queueTimeout: (chatId, messageId, position, maxTime) => ({
    text: `<b><u>🛠️ | REMOVIDO DA FILA!</u></b>\n\n` +
      `<blockquote><b> → Motivos e informações:</b>\n` +
      `<b> ↳ Posição era:</b> <code>${position}° lugar</code>\n` +
      `<b> ↳ Tempo máximo atingido:</b> <code>${maxTime}s</code>\n` +
      `<b> ↳ Possível causa:</b> <code>Alta demanda | Timeout</code></blockquote>\n\n` +
      `<b><u>🦠 | Esta solicitação não foi contabilizada.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  ownerOnly: (chatId, messageId) => ({
    text: `<b><u>🔒 | ACESSO RESTRITO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes do bloqueio:</b>\n` +
      `<b> ↳ Motivo:</b> <code>Comando exclusivo para administradores</code>\n` +
      `<b> ↳ Nível necessário:</b> <code>Admin</code></blockquote>\n\n` +
      `<b><u>☠️ | Você não possui permissão para isso.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  addvipUsage: (chatId, messageId) => ({
    text: `<b><u>⚙️ | USO INCORRETO DO COMANDO!</u></b>\n\n` +
      `<blockquote><b> → Como usar corretamente:</b>\n` +
      `<b> ↳ Sintaxe:</b> <code>/addvip {userId}</code>\n` +
      `<b> ↳ Exemplo:</b> <code>/addvip 123456789</code></blockquote>\n\n` +
      `<b><u>💐 | Corrija o comando e tente novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  addvipInvalid: (chatId, messageId) => ({
    text: `<b><u>⚙️ | DADOS INVÁLIDOS!</u></b>\n\n` +
      `<blockquote><b> → Como usar corretamente:</b>\n` +
      `<b> ↳ Sintaxe:</b> <code>/addvip {userId}</code>\n` +
      `<b> ↳ Motivo:</b> <code>ID de usuário inválido</code></blockquote>\n\n` +
      `<b><u>💐 | Informe um ID válido e tente novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  delvipUsage: (chatId, messageId) => ({
    text: `<b><u>⚙️ | USO INCORRETO DO COMANDO!</u></b>\n\n` +
      `<blockquote><b> → Como usar corretamente:</b>\n` +
      `<b> ↳ Sintaxe:</b> <code>/delvip {userId}</code>\n` +
      `<b> ↳ Exemplo:</b> <code>/delvip 123456789</code></blockquote>\n\n` +
      `<b><u>💐 | Corrija o comando e tente novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  delvipInvalid: (chatId, messageId) => ({
    text: `<b><u>⚙️ | DADOS INVÁLIDOS!</u></b>\n\n` +
      `<blockquote><b> → Como usar corretamente:</b>\n` +
      `<b> ↳ Sintaxe:</b> <code>/delvip {userId}</code>\n` +
      `<b> ↳ Motivo:</b> <code>ID de usuário inválido</code></blockquote>\n\n` +
      `<b><u>💐 | Informe um ID válido e tente novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  vipRemoved: (chatId, messageId, targetUserId) => ({
    text: `<b><u>✅ | VIP REMOVIDO COM SUCESSO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes da remoção:</b>\n` +
      `<b> ↳ UserId removido:</b> <code>${targetUserId}</code>\n` +
      `<b> ↳ Status:</b> <code>Acesso VIP cancelado imediatamente</code>\n` +
      `<b> ↳ Efeito:</b> <code>Usuário perde acesso aos recursos premium</code></blockquote>\n\n` +
      `<b><u>⚠️ | Operação concluída com sucesso.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  userNotFound: (chatId, messageId) => ({
    text: `<b><u>⚙️ | USUÁRIO NÃO ENCONTRADO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes do erro:</b>\n` +
      `<b> ↳ Motivo:</b> <code>ID não corresponde a nenhum usuário registrado</code>\n` +
      `<b> ↳ Dica:</b> <code>Verifique se o ID está correto</code></blockquote>\n\n` +
      `<b><u>💐 | Tente novamente com um ID válido.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  playerRecentLikes: (chatId, messageId, playerName = 'N/A', timeRemaining = '') => ({
    text: `<b><u>🦠 | JOGADOR RECEBEU LIKES RECENTEMENTE!</u></b>\n\n` +
      `<blockquote><b> → Status do cooldown:</b>\n` +
      `<b> ↳ Jogador:</b> <code>${playerName}</code>\n` +
      `<b> ↳ Tempo restante:</b> <code>${timeRemaining}</code>\n` +
      `<b> ↳ Motivo:</b> <code>Limite diário por conta atingido</code></blockquote>\n\n` +
      `<b><u>⏳ | Aguarde o cooldown para enviar novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  playerNotFound: (chatId, messageId, regionName, httpStatus, uid) => ({
    text: `<b><u>⚙️ | JOGADOR NÃO ENCONTRADO!</u></b>\n\n` +
      `<blockquote><b> → Status e informações:</b>\n` +
      `<b> ↳ ContaId:</b> <code>${uid}</code>\n` +
      `<b> ↳ Região selecionada:</b> <code>${regionName}</code>\n` +
      `<b> ↳ Código de erro:</b> <code>player_not_found</code>\n` +
      `<b> ↳ Status HTTP:</b> <code>${httpStatus}</code></blockquote>\n\n` +
      `<b><u>😣 | Verifique o ID e a região da sua conta.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  apiKeyError: (chatId, messageId, errorType) => ({
    text: `<b><u>🛠️ | ERRO INTERNO DA API!</u></b>\n\n` +
      `<blockquote><b> → Detalhes do erro:</b>\n` +
      `<b> ↳ Código do erro:</b> <code>${errorType}</code>\n` +
      `<b> ↳ Origem:</b> <code>Chave da API inválida ou expirada</code>\n` +
      `<b> ↳ Ação:</b> <code>Contate o suporte técnico</code></blockquote>\n\n` +
      `<b><u>💣 | Entre em contato para resolver este problema.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  genericError: (chatId, messageId, userId, uid, errorData) => ({
    text: `<b><u>🛠️ | SERVIDOR EM MANUTENÇÃO!</u></b>\n\n` +
      `<blockquote><b> → Status e resposta do servidor:</b>\n` +
      `<b> ↳ Tempo de espera:</b> <code>${errorData.responseTime || 'N/A'}</code>\n` +
      `<b> ↳ StatusCode:</b> <code>${errorData.status || 'N/A'}</code>\n` +
      `<b> ↳ ServerUrl:</b> <code>${errorData.apiUrl || 'N/A'}</code>\n` +
      `<b> ↳ Resposta JSON:</b>\n<code>${errorData.response || '{}'}</code></blockquote>\n\n` +
      `<b><u>💣 | Tente novamente em instantes.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  invalidUsage: (chatId, messageId) => ({
    text: `<b><u>🦠 | SOLICITAÇÃO INVÁLIDA!</u></b>\n\n` +
      `<blockquote expandable><b> → Como usar corretamente:</b>\n` +
      `<b> ↳ Sintaxe:</b> <code>/like {id}</code>\n` +
      `<b> ↳ Exemplo:</b> <code>/like 1033857091</code>\n` +
      `<b> ↳ Dica:</b> <code>Substitua {id} pelo seu ID real</code></blockquote>\n\n` +
      `<b><u>💐 | Corrija o comando e tente novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  divUsage: (chatId, messageId) => ({
    text: `<b><u>⚙️ | USO INCORRETO DO COMANDO!</u></b>\n\n` +
      `<blockquote><b> → Como usar corretamente:</b>\n` +
      `<b> ↳ Sintaxe:</b> <code>/not {mensagem}</code>\n` +
      `<b> ↳ Exemplo:</b> <code>/not 📢 Novas funcionalidades disponíveis!</code>\n` +
      `<b> ↳ Nível necessário:</b> <code>Admin</code></blockquote>\n\n` +
      `<b><u>💐 | Corrija o comando e tente novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  divPreview: (chatId, messageId, messageText, userId) => ({
    text: `<b><u>📢 | PRÉVIA DA DIVULGAÇÃO</u></b>\n\n` +
      `<blockquote>${messageText}</blockquote>\n\n` +
      `<b><u>⚠️ | Esta mensagem será enviada para todos os usuários.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ | CONFIRMAR ENVIO", callback_data: `div_confirm_${userId}` },
            { text: "❌ | CANCELAR", callback_data: `div_cancel_${userId}` }
          ]
        ]
      }
    }
  }),

  divConfirmed: (chatId, messageId, totalSent, totalFailed) => ({
    text: `<b><u>✅ | DIVULGAÇÃO CONCLUÍDA!</u></b>\n\n` +
      `<blockquote><b> → Resultado do envio em massa:</b>\n` +
      `<b> ↳ Mensagens enviadas:</b> <code>${totalSent}</code>\n` +
      `<b> ↳ Falhas:</b> <code>${totalFailed}</code>\n` +
      `<b> ↳ Status:</b> <code>Concluído</code></blockquote>\n\n` +
      `<b><u>📢 | Mensagem entregue a todos os usuários ativos.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  divCancelled: (chatId, messageId) => ({
    text: `<b><u>❌ | DIVULGAÇÃO CANCELADA!</u></b>\n\n` +
      `<blockquote><b> → Status da operação:</b>\n` +
      `<b> ↳ Ação:</b> <code>Cancelada pelo administrador</code>\n` +
      `<b> ↳ Efeito:</b> <code>Nenhuma mensagem foi enviada</code></blockquote>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  blockUsage: (chatId, messageId) => ({
    text: `<b><u>⚙️ | USO INCORRETO DO COMANDO!</u></b>\n\n` +
      `<blockquote><b> → Como usar corretamente:</b>\n` +
      `<b> ↳ Sintaxe:</b> <code>/block {userId} {motivo}</code>\n` +
      `<b> ↳ Exemplo:</b> <code>/block 123456789 Violou os termos de uso</code>\n` +
      `<b> ↳ Nível necessário:</b> <code>Admin</code></blockquote>\n\n` +
      `<b><u>💐 | Corrija o comando e tente novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  blockInvalid: (chatId, messageId) => ({
    text: `<b><u>⚙️ | DADOS INVÁLIDOS!</u></b>\n\n` +
      `<blockquote><b> → Como usar corretamente:</b>\n` +
      `<b> ↳ Sintaxe:</b> <code>/block {userId} {motivo}</code>\n` +
      `<b> ↳ Motivo:</b> <code>ID ou motivo não informado corretamente</code></blockquote>\n\n` +
      `<b><u>💐 | Informe os dados corretamente e tente novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  cannotBlockAdmin: (chatId, messageId) => ({
    text: `<b><u>🔒 | OPERAÇÃO NÃO PERMITIDA!</u></b>\n\n` +
      `<blockquote><b> → Detalhes da restrição:</b>\n` +
      `<b> ↳ Motivo:</b> <code>Não é possível bloquear um administrador</code></blockquote>\n\n` +
      `<b><u>☠️ | Apenas o desenvolvedor pode remover administradores.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  alreadyBlocked: (chatId, messageId, targetUserId) => ({
    text: `<b><u>⚙️ | USUÁRIO JÁ BLOQUEADO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes do status:</b>\n` +
      `<b> ↳ UserId:</b> <code>${targetUserId}</code>\n` +
      `<b> ↳ Status:</b> <code>Já está bloqueado no sistema</code></blockquote>\n\n` +
      `<b><u>💐 | Nenhuma ação foi necessária.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  blockSuccess: (chatId, messageId, targetUserId, reason) => ({
    text: `<b><u>✅ | USUÁRIO BLOQUEADO COM SUCESSO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes do bloqueio:</b>\n` +
      `<b> ↳ UserId bloqueado:</b> <code>${targetUserId}</code>\n` +
      `<b> ↳ Motivo:</b> <code>${reason}</code>\n` +
      `<b> ↳ Status:</b> <code>Acesso totalmente revogado</code>\n` +
      `<b> ↳ Efeito:</b> <code>Usuário perdeu todos os acessos</code></blockquote>\n\n` +
      `<b><u>⚠️ | Operação concluída com sucesso.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  unblockUsage: (chatId, messageId) => ({
    text: `<b><u>⚙️ | USO INCORRETO DO COMANDO!</u></b>\n\n` +
      `<blockquote><b> → Como usar corretamente:</b>\n` +
      `<b> ↳ Sintaxe:</b> <code>/desblock {userId}</code>\n` +
      `<b> ↳ Exemplo:</b> <code>/desblock 123456789</code>\n` +
      `<b> ↳ Nível necessário:</b> <code>Admin</code></blockquote>\n\n` +
      `<b><u>💐 | Corrija o comando e tente novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  unblockInvalid: (chatId, messageId) => ({
    text: `<b><u>⚙️ | DADOS INVÁLIDOS!</u></b>\n\n` +
      `<blockquote><b> → Como usar corretamente:</b>\n` +
      `<b> ↳ Sintaxe:</b> <code>/desblock {userId}</code>\n` +
      `<b> ↳ Motivo:</b> <code>ID de usuário inválido</code></blockquote>\n\n` +
      `<b><u>💐 | Informe um ID válido e tente novamente.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  notBlocked: (chatId, messageId, targetUserId) => ({
    text: `<b><u>⚙️ | USUÁRIO NÃO ESTÁ BLOQUEADO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes do status:</b>\n` +
      `<b> ↳ UserId:</b> <code>${targetUserId}</code>\n` +
      `<b> ↳ Status:</b> <code>Sem bloqueio registrado no sistema</code></blockquote>\n\n` +
      `<b><u>💐 | Nenhuma ação foi necessária.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  }),

  unblockSuccess: (chatId, messageId, targetUserId) => ({
    text: `<b><u>✅ | USUÁRIO DESBLOQUEADO COM SUCESSO!</u></b>\n\n` +
      `<blockquote><b> → Detalhes do desbloqueio:</b>\n` +
      `<b> ↳ UserId desbloqueado:</b> <code>${targetUserId}</code>\n` +
      `<b> ↳ Status:</b> <code>Acesso restaurado com sucesso</code>\n` +
      `<b> ↳ Efeito:</b> <code>Usuário pode usar o bot normalmente</code></blockquote>\n\n` +
      `<b><u>🔄 | Operação concluída com sucesso.</u></b>`,
    options: {
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: process.env.BUTTON_TEXT || 'Comunidade', url: process.env.BUTTON_URL || 'https://t.me/hubsqwGG' }
        ]]
      }
    }
  })
};

module.exports = messages;