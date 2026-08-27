/**
 * i18n dictionaries — flat, dot-namespaced keys.
 *
 * Scope (deliberately partial, see AGENTS note / commit message):
 * sidebar, header, dashboard + its widgets, and the Settings →
 * Profile tab (including the language picker itself). Everything
 * else in the app still renders in English regardless of the
 * chosen locale — this is an incremental rollout, not full coverage.
 *
 * `en` is the source of truth for which keys exist — `pt-BR` is
 * typed as `Record<DictKey, string>` so a missing translation is a
 * compile error, not a silent fallback.
 */

export const en = {
  // Sidebar
  "nav.dashboard": "Dashboard",
  "nav.inbox": "Inbox",
  "nav.contacts": "Contacts",
  "nav.pipelines": "Pipelines",
  "nav.tasks": "Tasks",
  "nav.broadcasts": "Broadcasts",
  "nav.automations": "Automations",
  "nav.flows": "Flows",

  // Header
  "header.profile": "Profile",
  "header.settings": "Settings",
  "header.signOut": "Sign out",

  // Dashboard page
  "dashboard.title": "Dashboard",
  "dashboard.subtitle":
    "Live analytics across conversations, contacts, deals, broadcasts, and automations.",
  "dashboard.metric.activeConversations": "Active Conversations",
  "dashboard.metric.newContactsToday": "New Contacts Today",
  "dashboard.metric.openDealsValue": "Open Deals Value",
  "dashboard.metric.messagesSentToday": "Messages Sent Today",
  "dashboard.openDeal": "open deal",
  "dashboard.openDeals": "open deals",
  "dashboard.delta.noChange": "No change {suffix}",
  "dashboard.delta.suffixNewToday": "new today vs yesterday",
  "dashboard.delta.suffixVsYesterday": "vs yesterday",

  // Quick actions
  "quickActions.newContact": "New Contact",
  "quickActions.newDeal": "New Deal",
  "quickActions.newBroadcast": "New Broadcast",
  "quickActions.newAutomation": "New Automation",

  // Conversations chart
  "conversationsChart.title": "Conversations Over Time",
  "conversationsChart.subtitle": "Daily message volume by direction",
  "conversationsChart.days": "{n} days",
  "conversationsChart.incoming": "Incoming",
  "conversationsChart.outgoing": "Outgoing",
  "conversationsChart.tooltipIncoming": "incoming",
  "conversationsChart.tooltipOutgoing": "outgoing",
  "conversationsChart.emptyTitle": "No message activity in this range",
  "conversationsChart.emptyHint":
    "Send or receive messages to start populating this chart.",

  // Pipeline donut
  "pipelineDonut.title": "Pipeline Value",
  "pipelineDonut.subtitle": "Open deals by stage",
  "pipelineDonut.total": "Total",
  "pipelineDonut.deal": "deal",
  "pipelineDonut.deals": "deals",
  "pipelineDonut.emptyTitle": "No open deals yet",
  "pipelineDonut.emptyHint":
    "Create deals in Pipelines to see stage breakdowns here.",

  // Response time chart
  "responseTimeChart.title": "Average First Response Time",
  "responseTimeChart.subtitle":
    "Minutes to reply to a customer's first unreplied message, by weekday",
  "responseTimeChart.target": "target {n}m",
  "responseTimeChart.thisWeek": "This week:",
  "responseTimeChart.lastWeek": "Last week:",
  "responseTimeChart.emptyTitle": "No replies recorded yet",
  "responseTimeChart.emptyHint":
    "This chart fills in as you reply to customer messages.",

  // Activity feed
  "activityFeed.title": "Recent Activity",
  "activityFeed.viewAll": "View all →",
  "activityFeed.showing": "Showing {shown} of {total}",
  "activityFeed.show": "Show",
  "activityFeed.emptyTitle": "No activity yet",
  "activityFeed.emptyHint":
    "Activity from messages, deals, broadcasts, and automations will appear here.",

  // Settings → Profile
  "settingsProfile.title": "Profile",
  "settingsProfile.subtitle":
    "How you show up across the app. Your avatar and name appear in the header, sidebar, and anywhere your teammates see you.",
  "settingsProfile.uploadPhoto": "Upload photo",
  "settingsProfile.changePhoto": "Change photo",
  "settingsProfile.remove": "Remove",
  "settingsProfile.fileHint": "PNG, JPG, WebP, or GIF. Up to 2 MB.",
  "settingsProfile.displayName": "Display name",
  "settingsProfile.email": "Email",
  "settingsProfile.emailChangeNotice":
    "Check the inbox for {oldEmail} and {newEmail} — both need to confirm before the change takes effect.",
  "settingsProfile.accountDetails": "Account details",
  "settingsProfile.role": "Role",
  "settingsProfile.joined": "Joined",
  "settingsProfile.userId": "User ID",
  "settingsProfile.loading": "Loading your profile…",
  "settingsProfile.save": "Save changes",
  "settingsProfile.saving": "Saving…",

  // Settings → Profile → Language
  "settingsLanguage.title": "Language",
  "settingsLanguage.subtitle": "Choose the language used across the app. Saved to your account, so it follows you to any device.",
  "settingsLanguage.english": "English",
  "settingsLanguage.portuguese": "Português (Brasil)",
} as const;

export type DictKey = keyof typeof en;

export const ptBR: Record<DictKey, string> = {
  // Sidebar
  "nav.dashboard": "Painel",
  "nav.inbox": "Caixa de entrada",
  "nav.contacts": "Contatos",
  "nav.pipelines": "Funis",
  "nav.tasks": "Tarefas",
  "nav.broadcasts": "Disparos",
  "nav.automations": "Automações",
  "nav.flows": "Fluxos",

  // Header
  "header.profile": "Perfil",
  "header.settings": "Configurações",
  "header.signOut": "Sair",

  // Dashboard page
  "dashboard.title": "Painel",
  "dashboard.subtitle":
    "Análises em tempo real de conversas, contatos, negócios, disparos e automações.",
  "dashboard.metric.activeConversations": "Conversas Ativas",
  "dashboard.metric.newContactsToday": "Novos Contatos Hoje",
  "dashboard.metric.openDealsValue": "Valor em Negócios Abertos",
  "dashboard.metric.messagesSentToday": "Mensagens Enviadas Hoje",
  "dashboard.openDeal": "negócio aberto",
  "dashboard.openDeals": "negócios abertos",
  "dashboard.delta.noChange": "Sem alteração {suffix}",
  "dashboard.delta.suffixNewToday": "novos hoje vs. ontem",
  "dashboard.delta.suffixVsYesterday": "vs. ontem",

  // Quick actions
  "quickActions.newContact": "Novo Contato",
  "quickActions.newDeal": "Novo Negócio",
  "quickActions.newBroadcast": "Novo Disparo",
  "quickActions.newAutomation": "Nova Automação",

  // Conversations chart
  "conversationsChart.title": "Conversas ao Longo do Tempo",
  "conversationsChart.subtitle": "Volume diário de mensagens por direção",
  "conversationsChart.days": "{n} dias",
  "conversationsChart.incoming": "Recebidas",
  "conversationsChart.outgoing": "Enviadas",
  "conversationsChart.tooltipIncoming": "recebidas",
  "conversationsChart.tooltipOutgoing": "enviadas",
  "conversationsChart.emptyTitle": "Sem atividade de mensagens nesse período",
  "conversationsChart.emptyHint":
    "Envie ou receba mensagens pra começar a preencher esse gráfico.",

  // Pipeline donut
  "pipelineDonut.title": "Valor do Funil",
  "pipelineDonut.subtitle": "Negócios abertos por etapa",
  "pipelineDonut.total": "Total",
  "pipelineDonut.deal": "negócio",
  "pipelineDonut.deals": "negócios",
  "pipelineDonut.emptyTitle": "Nenhum negócio aberto ainda",
  "pipelineDonut.emptyHint":
    "Crie negócios em Funis pra ver o detalhamento por etapa aqui.",

  // Response time chart
  "responseTimeChart.title": "Tempo Médio de Primeira Resposta",
  "responseTimeChart.subtitle":
    "Minutos até responder a primeira mensagem sem resposta de um cliente, por dia da semana",
  "responseTimeChart.target": "meta {n}m",
  "responseTimeChart.thisWeek": "Esta semana:",
  "responseTimeChart.lastWeek": "Semana passada:",
  "responseTimeChart.emptyTitle": "Nenhuma resposta registrada ainda",
  "responseTimeChart.emptyHint":
    "Esse gráfico se preenche conforme você responde mensagens de clientes.",

  // Activity feed
  "activityFeed.title": "Atividade Recente",
  "activityFeed.viewAll": "Ver tudo →",
  "activityFeed.showing": "Mostrando {shown} de {total}",
  "activityFeed.show": "Mostrar",
  "activityFeed.emptyTitle": "Nenhuma atividade ainda",
  "activityFeed.emptyHint":
    "Atividades de mensagens, negócios, disparos e automações vão aparecer aqui.",

  // Settings → Profile
  "settingsProfile.title": "Perfil",
  "settingsProfile.subtitle":
    "Como você aparece pelo app. Seu avatar e nome aparecem no cabeçalho, no menu lateral e em qualquer lugar que sua equipe te vê.",
  "settingsProfile.uploadPhoto": "Enviar foto",
  "settingsProfile.changePhoto": "Trocar foto",
  "settingsProfile.remove": "Remover",
  "settingsProfile.fileHint": "PNG, JPG, WebP ou GIF. Até 2 MB.",
  "settingsProfile.displayName": "Nome de exibição",
  "settingsProfile.email": "E-mail",
  "settingsProfile.emailChangeNotice":
    "Confira a caixa de entrada de {oldEmail} e {newEmail} — os dois precisam confirmar antes da troca valer.",
  "settingsProfile.accountDetails": "Detalhes da conta",
  "settingsProfile.role": "Papel",
  "settingsProfile.joined": "Entrou em",
  "settingsProfile.userId": "ID do usuário",
  "settingsProfile.loading": "Carregando seu perfil…",
  "settingsProfile.save": "Salvar alterações",
  "settingsProfile.saving": "Salvando…",

  // Settings → Profile → Language
  "settingsLanguage.title": "Idioma",
  "settingsLanguage.subtitle": "Escolha o idioma usado no app. Fica salvo na sua conta, então acompanha você em qualquer dispositivo.",
  "settingsLanguage.english": "English",
  "settingsLanguage.portuguese": "Português (Brasil)",
};

export const dictionaries = { en, "pt-BR": ptBR } as const;
export type Locale = keyof typeof dictionaries;
export const LOCALES: Locale[] = ["en", "pt-BR"];
