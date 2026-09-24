import type { Metadata } from 'next';
import { H, LegalPage, Mail, UL } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Exclusão de Dados · Deileads',
  description: 'Como pedir a exclusão dos seus dados no Deileads.',
};

export default function ExclusaoDeDadosPage() {
  return (
    <LegalPage
      title="Exclusão de Dados"
      titleEn="Data Deletion Instructions"
      english={<English />}
    >
      <H>Empresas que usam o Deileads</H>
      <UL>
        <li>
          <strong>Desconectar integrações:</strong> em Configurações → WhatsApp ou Instagram, um
          administrador pode desconectar a conta a qualquer momento. As credenciais de acesso da
          Meta são apagadas na hora.
        </li>
        <li>
          <strong>Excluir a conta e todos os dados:</strong> o administrador envia um e-mail para{' '}
          <Mail /> com o assunto &quot;Exclusão de dados&quot;, a partir do e-mail cadastrado na
          conta. Confirmamos o pedido e excluímos contatos, conversas, mensagens, leads e
          credenciais em até 30 dias, enviando confirmação ao final.
        </li>
      </UL>

      <H>Quem conectou o Facebook, Instagram ou WhatsApp ao Deileads</H>
      <UL>
        <li>
          No Facebook, acesse Configurações e privacidade → Configurações → Integrações comerciais
          (ou Apps e sites), encontre &quot;deileads&quot; e clique em Remover. Isso encerra o
          acesso do Deileads à sua conta.
        </li>
        <li>
          Para apagar também os dados que já recebemos, envie um e-mail para <Mail /> com o
          assunto &quot;Exclusão de dados&quot; informando o nome da empresa ou o número de
          WhatsApp conectado. A exclusão é feita em até 30 dias.
        </li>
      </UL>

      <H>Clientes de empresas que usam o Deileads</H>
      <p>
        Se você conversou por WhatsApp, Instagram ou preencheu um formulário de uma empresa que
        usa o Deileads, essa empresa é a controladora dos seus dados. Peça a exclusão diretamente a
        ela. Se não conseguir, escreva para <Mail /> informando o nome da empresa e seu telefone ou
        e-mail, e encaminharemos o pedido.
      </p>

      <p className="text-sm text-slate-500">
        Alguns registros podem ser mantidos pelo prazo exigido por lei (por exemplo, registros de
        acesso por 6 meses, conforme o Marco Civil da Internet) e são apagados ao fim desse prazo.
      </p>
    </LegalPage>
  );
}

function English() {
  return (
    <>
      <H>Businesses that use Deileads</H>
      <UL>
        <li>
          <strong>Disconnect integrations:</strong> in Settings → WhatsApp or Instagram, an
          administrator can disconnect the account at any time. Meta access credentials are
          deleted immediately.
        </li>
        <li>
          <strong>Delete the account and all data:</strong> the administrator emails <Mail /> with
          the subject &quot;Data deletion&quot;, from the email registered on the account. We
          confirm the request and delete contacts, conversations, messages, leads and credentials
          within 30 days, and send a confirmation when done.
        </li>
      </UL>

      <H>People who connected Facebook, Instagram or WhatsApp to Deileads</H>
      <UL>
        <li>
          On Facebook, go to Settings &amp; privacy → Settings → Business integrations (or Apps
          and websites), find &quot;deileads&quot; and click Remove. This ends Deileads&apos;
          access to your account.
        </li>
        <li>
          To also delete data we already received, email <Mail /> with the subject &quot;Data
          deletion&quot;, including the business name or the connected WhatsApp number. Deletion
          is completed within 30 days.
        </li>
      </UL>

      <H>Customers of businesses that use Deileads</H>
      <p>
        If you messaged a business on WhatsApp or Instagram, or filled out a form of a business
        that uses Deileads, that business is the controller of your data. Please ask it directly
        to delete your data. If you cannot reach it, email <Mail /> with the business name and
        your phone or email, and we will forward the request.
      </p>

      <p className="text-sm text-slate-500">
        Some records may be kept for the period required by law (for example, access logs for 6
        months under Brazil&apos;s Internet Civil Framework) and are deleted at the end of that
        period.
      </p>
    </>
  );
}
