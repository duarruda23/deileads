import type { Metadata } from 'next';
import Link from 'next/link';
import { H, LEGAL, LegalPage, Mail, UL } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Política de Privacidade · Deileads',
  description: 'Como o Deileads coleta, usa, armazena e protege dados pessoais.',
};

export default function PrivacidadePage() {
  return (
    <LegalPage
      title="Política de Privacidade"
      titleEn="Privacy Policy"
      english={<English />}
    >
      <p>
        O Deileads é um CRM on-line para pequenas e médias empresas organizarem leads,
        funil de vendas e conversas de WhatsApp e Instagram com seus clientes. O Deileads é
        operado pela {LEGAL.company}, inscrita no CNPJ {LEGAL.cnpj}, com sede em{' '}
        {LEGAL.address} (&quot;Virgo&quot;, &quot;nós&quot;). Esta política explica quais dados
        tratamos, para quê e quais são os seus direitos, nos termos da Lei nº 13.709/2018 (LGPD).
      </p>

      <H>1. Papéis no tratamento de dados</H>
      <UL>
        <li>
          <strong>Dados da conta</strong> (quem usa o Deileads: nome, e-mail, telefone, perfil de
          acesso): a Virgo é a <strong>controladora</strong>.
        </li>
        <li>
          <strong>Dados dos clientes das empresas</strong> (contatos, mensagens, leads): a empresa
          que contrata o Deileads é a <strong>controladora</strong> e a Virgo atua como{' '}
          <strong>operadora</strong>, tratando esses dados apenas conforme as instruções da empresa
          e para prestar o serviço.
        </li>
      </UL>

      <H>2. Dados que tratamos</H>
      <UL>
        <li>Cadastro e acesso: nome, e-mail, telefone, senha (armazenada com hash), cargo e permissões.</li>
        <li>
          Dados de integrações com a Meta, quando a empresa conecta suas contas: identificadores da
          conta do WhatsApp Business, números de telefone comerciais, modelos de mensagem, mensagens
          enviadas e recebidas (texto e mídia), nome de perfil e número dos contatos; mensagens do
          Instagram Direct da conta profissional conectada; respostas de formulários de anúncios de
          cadastro (Lead Ads) da Página conectada, como nome, telefone, e-mail e respostas às
          perguntas do formulário.
        </li>
        <li>
          Quando a empresa conecta o número pelo app WhatsApp Business (coexistência): contatos da
          agenda do app e histórico de conversas de até 6 meses, se a própria empresa autorizar o
          compartilhamento no momento da conexão.
        </li>
        <li>Dados inseridos pelos usuários: contatos, negócios, anotações, tarefas, etiquetas.</li>
        <li>Dados técnicos: registros de acesso (IP, data e hora, navegador) e cookies de sessão necessários para o login.</li>
      </UL>

      <H>3. Para que usamos os dados</H>
      <UL>
        <li>Prestar o serviço: exibir e enviar mensagens, organizar leads no funil, importar leads de formulários, executar automações configuradas pela empresa.</li>
        <li>Autenticar usuários, manter a segurança e prevenir fraudes e abusos.</li>
        <li>Cumprir obrigações legais e regulatórias.</li>
        <li>Suporte e comunicação sobre a conta.</li>
      </UL>
      <p>
        Não vendemos dados pessoais, não usamos os dados das integrações com a Meta para
        publicidade nem para treinar modelos, e não os compartilhamos com terceiros para
        finalidades próprias deles.
      </p>

      <H>4. Dados da Plataforma Meta (WhatsApp, Instagram e Facebook)</H>
      <p>
        Os dados recebidos pelas APIs da Meta são usados exclusivamente para oferecer os recursos
        do Deileads à empresa que conectou a conta, dentro da conta dessa empresa, e ficam visíveis
        apenas aos usuários autorizados por ela. Os tokens de acesso são armazenados criptografados
        (AES-256-GCM). O tratamento segue os Termos da Plataforma Meta e a Política do WhatsApp
        Business. A empresa pode desconectar suas contas a qualquer momento em Configurações.
      </p>

      <H>5. Compartilhamento</H>
      <p>Compartilhamos dados apenas com fornecedores necessários para operar o serviço:</p>
      <UL>
        <li>Meta Platforms (APIs do WhatsApp, Instagram e Lead Ads), para enviar e receber mensagens e leads;</li>
        <li>Supabase (banco de dados e autenticação) e Vercel (hospedagem da aplicação);</li>
        <li>autoridades públicas, quando exigido por lei ou ordem judicial.</li>
      </UL>

      <H>6. Transferência internacional</H>
      <p>
        Os servidores do Deileads ficam nos Estados Unidos. A transferência ocorre com base nas
        hipóteses do art. 33 da LGPD, com fornecedores que adotam salvaguardas contratuais e
        técnicas de segurança.
      </p>

      <H>7. Retenção</H>
      <p>
        Mantemos os dados enquanto a conta da empresa estiver ativa. Após o encerramento da conta
        ou um pedido de exclusão, os dados são excluídos em até 30 dias, exceto os que precisarmos
        guardar por obrigação legal (por exemplo, registros de acesso por 6 meses, conforme o
        Marco Civil da Internet).
      </p>

      <H>8. Segurança</H>
      <p>
        Usamos conexão criptografada (HTTPS), criptografia de credenciais, controle de acesso por
        conta e por usuário e verificação de assinatura em todos os webhooks recebidos da Meta.
      </p>

      <H>9. Seus direitos</H>
      <p>
        Você pode pedir confirmação de tratamento, acesso, correção, anonimização, portabilidade,
        exclusão, informação sobre compartilhamento e revogação de consentimento (art. 18 da LGPD).
        Se você é cliente de uma empresa que usa o Deileads, faça o pedido diretamente a essa
        empresa; nós a apoiaremos no atendimento. Veja também a página de{' '}
        <Link href="/exclusao-de-dados" className="underline">
          exclusão de dados
        </Link>
        .
      </p>

      <H>10. Contato e encarregado</H>
      <p>
        Encarregado pelo tratamento de dados pessoais: <Mail />. Você também pode reclamar à
        Autoridade Nacional de Proteção de Dados (ANPD).
      </p>

      <H>11. Alterações</H>
      <p>
        Podemos atualizar esta política. A data da última atualização fica no topo da página, e
        mudanças relevantes serão comunicadas aos administradores das contas.
      </p>
    </LegalPage>
  );
}

function English() {
  return (
    <>
      <p>
        Deileads is an online CRM that helps small and medium businesses organize leads, sales
        pipelines and WhatsApp and Instagram conversations with their customers. Deileads is
        operated by {LEGAL.company} (Brazilian company registration CNPJ {LEGAL.cnpj}),{' '}
        {LEGAL.address} (&quot;Virgo&quot;, &quot;we&quot;). This policy explains what data we
        process, why, and your rights under Brazil&apos;s General Data Protection Law (LGPD).
      </p>

      <H>1. Roles</H>
      <UL>
        <li>
          <strong>Account data</strong> (people who use Deileads: name, email, phone, access role):
          Virgo is the <strong>controller</strong>.
        </li>
        <li>
          <strong>Data about the businesses&apos; customers</strong> (contacts, messages, leads):
          the business that uses Deileads is the <strong>controller</strong>, and Virgo acts as{' '}
          <strong>processor</strong>, processing that data only on the business&apos;s
          instructions and to provide the service.
        </li>
      </UL>

      <H>2. Data we process</H>
      <UL>
        <li>Account and access: name, email, phone, password (stored hashed), role and permissions.</li>
        <li>
          Meta integration data, when a business connects its accounts: WhatsApp Business Account
          identifiers, business phone numbers, message templates, sent and received messages (text
          and media), contacts&apos; profile name and phone number; Instagram Direct messages of
          the connected professional account; Lead Ads form responses of the connected Page (such
          as name, phone, email and answers to form questions).
        </li>
        <li>
          When a business connects a number that is also used in the WhatsApp Business app
          (coexistence): the app&apos;s contacts and up to 6 months of chat history, only if the
          business chooses to share it during onboarding.
        </li>
        <li>Data entered by users: contacts, deals, notes, tasks, tags.</li>
        <li>Technical data: access logs (IP, date and time, browser) and session cookies required for login.</li>
      </UL>

      <H>3. How we use data</H>
      <UL>
        <li>To provide the service: show and send messages, organize leads in the pipeline, import form leads, run automations the business configured.</li>
        <li>To authenticate users, keep the service secure and prevent fraud and abuse.</li>
        <li>To comply with legal obligations.</li>
        <li>For support and account communications.</li>
      </UL>
      <p>
        We do not sell personal data, we do not use data received from Meta&apos;s APIs for
        advertising or to train models, and we do not share it with third parties for their own
        purposes.
      </p>

      <H>4. Meta Platform data (WhatsApp, Instagram and Facebook)</H>
      <p>
        Data received from Meta&apos;s APIs is used only to provide Deileads features to the
        business that connected the account, inside that business&apos;s account, and is visible
        only to users that business authorized. Access tokens are stored encrypted (AES-256-GCM).
        Processing follows the Meta Platform Terms and the WhatsApp Business Policy. A business
        can disconnect its accounts at any time in Settings.
      </p>

      <H>5. Sharing</H>
      <p>We share data only with providers required to run the service:</p>
      <UL>
        <li>Meta Platforms (WhatsApp, Instagram and Lead Ads APIs), to send and receive messages and leads;</li>
        <li>Supabase (database and authentication) and Vercel (application hosting);</li>
        <li>public authorities, when required by law or court order.</li>
      </UL>

      <H>6. International transfers</H>
      <p>
        Deileads servers are located in the United States. Transfers rely on the legal bases of
        article 33 of the LGPD, with providers that apply contractual and technical safeguards.
      </p>

      <H>7. Retention</H>
      <p>
        We keep data while the business account is active. After the account is closed or a
        deletion request is received, data is deleted within 30 days, except data we must keep by
        law (for example, access logs for 6 months under Brazil&apos;s Internet Civil Framework).
      </p>

      <H>8. Security</H>
      <p>
        We use encrypted connections (HTTPS), credential encryption, per-account and per-user
        access control, and signature verification on every webhook received from Meta.
      </p>

      <H>9. Your rights</H>
      <p>
        You may request confirmation of processing, access, correction, anonymization,
        portability, deletion, information about sharing and withdrawal of consent (LGPD article
        18). If you are a customer of a business that uses Deileads, contact that business first;
        we will support it in handling your request. See also the{' '}
        <Link href="/exclusao-de-dados#en" className="underline">
          data deletion
        </Link>{' '}
        page.
      </p>

      <H>10. Contact and data protection officer</H>
      <p>
        Data protection officer: <Mail />. You may also file a complaint with Brazil&apos;s
        National Data Protection Authority (ANPD).
      </p>

      <H>11. Changes</H>
      <p>
        We may update this policy. The last update date is shown at the top of the page, and
        material changes will be communicated to account administrators.
      </p>
    </>
  );
}
