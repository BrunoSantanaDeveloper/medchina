-- ============================================================
-- 0095_professional_credentials: quem assina o documento, por escrito.
--
-- Todo PDF que sai do produto — atestado, receituário, plano terapêutico,
-- orientações para a paciente — é assinado apenas com o nome da profissional.
-- Um documento clínico que vai para a mão da paciente, para um convênio ou para
-- outro profissional precisa dizer QUEM o emitiu com a credencial: o registro
-- profissional e a titulação. Sem isso o papel não se sustenta fora do
-- consultório, e era a própria profissional quem tinha de escrever isso à mão
-- em cima do documento impresso.
--
-- Dois campos livres, deliberadamente:
--
--   * professional_registration — "CNAA 3086", "CREFITO-3 12345/F", "CRM 11111".
--     A acupuntura no Brasil não tem um conselho único: CNAA e ABA são
--     associações, e fisioterapeutas, médicos e biomédicos que agulham carregam
--     o registro do SEU conselho. Modelar como (conselho, número, UF) obrigaria
--     a manter uma lista de conselhos que não fecha e recusaria a credencial de
--     quem não está nela. Ela escreve como consta no seu documento.
--
--   * professional_title — "Acupunturista Especialista em Medicina Chinesa".
--     A titulação que ela usa profissionalmente, nas palavras dela.
--
-- Ambos são OPCIONAIS: um documento sem credencial continua sendo emitido, com
-- a assinatura que já tinha. Preencher é o que acrescenta a linha ao PDF.
-- ============================================================

alter table public.profiles
  add column if not exists professional_registration text,
  add column if not exists professional_title text;

comment on column public.profiles.professional_registration is
  'Registro profissional como consta no documento dela ("CNAA 3086", "CREFITO-3 12345/F"). Livre por desenho: a acupuntura não tem conselho único no Brasil.';
comment on column public.profiles.professional_title is
  'Titulação usada nos documentos que ela assina ("Acupunturista Especialista em Medicina Chinesa").';

-- Um campo que entra em PDF assinado não recebe um payload. Os limites são
-- generosos para caber uma titulação longa e curtos o bastante para que o
-- rodapé do documento continue legível.
alter table public.profiles
  drop constraint if exists profiles_professional_credentials_lengths;
alter table public.profiles
  add constraint profiles_professional_credentials_lengths check (
    (professional_registration is null or char_length(professional_registration) <= 60)
    and (professional_title is null or char_length(professional_title) <= 120)
  );
