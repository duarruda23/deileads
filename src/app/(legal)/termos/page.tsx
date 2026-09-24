import type { Metadata } from 'next';
import Link from 'next/link';
import { H, LEGAL, LegalPage, Mail, UL } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Termos de Uso · Deileads',
  description: 'Condições de uso do Deileads.',
};

export default function TermosPage() {
  return (
    <LegalPage title="Termos de Uso" titleEn="Terms of Service" english={<English />}>
      <p>
        Estes termos regem o uso do Deileads, CRM on-line operado pela {LEGAL.company}, CNPJ{' '}
        {LEGAL.cnpj} (&quot;Virgo&quot;). Ao criar uma conta ou usar o Deileads, a empresa
        contratante (&quot;Cliente&quot;) e seus usuários concordam com estes termos e com a{' '}
        <Link href="/privacidade" className="underline">
          Política de Privacidade
        </Link>
        .
      </p>

      <H>1. O serviço</H>
      <p>
        O Deileads oferece caixa de entrada compartilhada de WhatsApp e Instagram, funil de vendas,
        importação de leads de formulários (incluindo anúncios de cadastro da Meta), disparos de
        modelos de mensagem aprovados e automações. Recursos que dependem da Meta funcionam por meio
        das APIs oficiais e estão sujeitos à disponibilidade e às regras da Meta.
      </p>

      <H>2. Conta e acesso</H>
      <UL>
        <li>O Cliente é responsável pelos usuários que convida, pelas permissões que concede e pela guarda das senhas.</li>
        <li>O Cliente só deve conectar contas de WhatsApp, Instagram e Páginas que tenha o direito de administrar.</li>
      </UL>

      <H>3. Uso aceitável</H>
      <p>O Cliente se compromete a:</p>
      <UL>
        <li>
          cumprir a Política do WhatsApp Business, a Política Comercial do WhatsApp, os Termos da
          Plataforma Meta e a legislação aplicável, incluindo a LGPD e o Código de Defesa do
          Consumidor;
        </li>
        <li>
          enviar mensagens iniciadas pela empresa apenas a pessoas que tenham dado consentimento
          (opt-in) e respeitar pedidos de descadastro;
        </li>
        <li>não enviar spam, conteúdo ilegal, enganoso, ofensivo ou que viole direitos de terceiros;</li>
        <li>não tentar burlar limites técnicos, acessar dados de outras contas ou prejudicar o serviço.</li>
      </UL>
      <p>
        A Virgo pode suspender o acesso em caso de violação destes termos ou de risco à
        plataforma, à Meta ou a terceiros.
      </p>

      <H>4. Dados do Cliente</H>
      <p>
        Os contatos, mensagens e leads tratados no Deileads pertencem ao Cliente, que é o
        controlador desses dados e responsável pela base legal para tratá-los. A Virgo atua como
        operadora, conforme a Política de Privacidade.
      </p>

      <H>5. Planos e pagamento</H>
      <p>
        Preço, período e forma de pagamento seguem a proposta ou o contrato firmado com o
        Cliente. Custos cobrados pela Meta pelo envio de mensagens (conversas e modelos) são de
        responsabilidade do Cliente e pagos diretamente à Meta, salvo acordo diferente.
      </p>

      <H>6. Disponibilidade e responsabilidade</H>
      <p>
        Trabalhamos para manter o serviço disponível e seguro, mas ele é oferecido sem garantia de
        funcionamento ininterrupto. A Virgo não responde por indisponibilidades, mudanças ou
        bloqueios causados pela Meta ou por outros fornecedores, nem por lucros cessantes. A
        responsabilidade total da Virgo fica limitada ao valor pago pelo Cliente nos 12 meses
        anteriores ao evento.
      </p>

      <H>7. Encerramento</H>
      <p>
        O Cliente pode encerrar a conta a qualquer momento. Após o encerramento, os dados são
        excluídos conforme a Política de Privacidade e a página de{' '}
        <Link href="/exclusao-de-dados" className="underline">
          exclusão de dados
        </Link>
        .
      </p>

      <H>8. Alterações e foro</H>
      <p>
        Podemos atualizar estes termos, avisando os administradores das contas sobre mudanças
        relevantes. Aplica-se a lei brasileira, e fica eleito o foro da comarca de Caruaru-PE.
        Dúvidas: <Mail />.
      </p>
    </LegalPage>
  );
}

function English() {
  return (
    <>
      <p>
        These terms govern the use of Deileads, an online CRM operated by {LEGAL.company}{' '}
        (CNPJ {LEGAL.cnpj}, &quot;Virgo&quot;). By creating an account or using Deileads, the
        subscribing business (&quot;Customer&quot;) and its users agree to these terms and to the{' '}
        <Link href="/privacidade#en" className="underline">
          Privacy Policy
        </Link>
        .
      </p>

      <H>1. The service</H>
      <p>
        Deileads provides a shared WhatsApp and Instagram inbox, a sales pipeline, lead import from
        forms (including Meta Lead Ads), sending of approved message templates and automations.
        Features that depend on Meta work through Meta&apos;s official APIs and are subject to
        Meta&apos;s availability and rules.
      </p>

      <H>2. Accounts and access</H>
      <UL>
        <li>The Customer is responsible for the users it invites, the permissions it grants and keeping passwords safe.</li>
        <li>The Customer may only connect WhatsApp accounts, Instagram accounts and Pages it is entitled to manage.</li>
      </UL>

      <H>3. Acceptable use</H>
      <p>The Customer agrees to:</p>
      <UL>
        <li>
          comply with the WhatsApp Business Policy, the WhatsApp Commerce Policy, the Meta Platform
          Terms and applicable law, including the LGPD and consumer protection law;
        </li>
        <li>
          send business-initiated messages only to people who opted in, and honor opt-out
          requests;
        </li>
        <li>not send spam or illegal, misleading or offensive content, or content that infringes third-party rights;</li>
        <li>not circumvent technical limits, access other accounts&apos; data or disrupt the service.</li>
      </UL>
      <p>
        Virgo may suspend access if these terms are violated or if there is a risk to the
        platform, to Meta or to third parties.
      </p>

      <H>4. Customer data</H>
      <p>
        Contacts, messages and leads processed in Deileads belong to the Customer, who is the
        controller of that data and responsible for the legal basis to process it. Virgo acts as
        processor, as described in the Privacy Policy.
      </p>

      <H>5. Plans and payment</H>
      <p>
        Price, term and payment follow the proposal or contract agreed with the Customer. Fees
        charged by Meta for messaging (conversations and templates) are the Customer&apos;s
        responsibility and paid directly to Meta, unless otherwise agreed.
      </p>

      <H>6. Availability and liability</H>
      <p>
        We work to keep the service available and secure, but it is provided without a guarantee
        of uninterrupted operation. Virgo is not liable for outages, changes or blocks caused by
        Meta or other providers, nor for lost profits. Virgo&apos;s total liability is limited to
        the amount paid by the Customer in the 12 months before the event.
      </p>

      <H>7. Termination</H>
      <p>
        The Customer may close its account at any time. After closing, data is deleted as
        described in the Privacy Policy and the{' '}
        <Link href="/exclusao-de-dados#en" className="underline">
          data deletion
        </Link>{' '}
        page.
      </p>

      <H>8. Changes and governing law</H>
      <p>
        We may update these terms and will notify account administrators of material changes.
        Brazilian law applies, and the courts of Caruaru-PE, Brazil, have jurisdiction.
        Questions: <Mail />.
      </p>
    </>
  );
}
