# CRM de acompanhamento de mailings

Aplicação preparada para **Cloudflare Workers + D1**, com interface e API na mesma origem. O repositório contém somente código, configuração, migrações e testes fictícios. Nenhuma planilha ou informação de paciente deve ser versionada.

## O que está implementado

- Login por e-mail e senha, sem cadastro público. Primeiro administrador criado por comando administrativo.
- Apenas o administrador cadastra usuários e define suas UBS/estabelecimentos. A API aplica as permissões em cada consulta, alteração e exportação.
- Convite individual para definir a própria senha, válido por 24 horas e um uso. O administrador copia e compartilha o link; envio automático por e-mail não está configurado. Novo convite invalida o anterior. Desativação revoga sessões; alteração de e-mail exige nova definição de senha.
- Importação exclusivamente em Excel `.xlsx`, prévia por UBS e de/para das colunas. O servidor relê e valida o Excel original, sem confiar nos registros enviados pelo navegador. Cabeçalhos, unidades e situação operacional seguem o CRM anterior. Hash SHA-256 impede repetir o mesmo arquivo, mesmo renomeado.
- Panorama → mailing → UBS/procedimento → registros. Volume de linhas, preenchimento, conclusão, pendências, parados e usuários com atuação registrada.
- Datas de primeiro, segundo e terceiro contato, médias da publicação até cada contato e intervalos entre contatos. Datas em ordem, entre a publicação e o dia atual de São Paulo.
- Produtividade por usuário e mailing, autoria vinculada ao login, tempo até finalizar os casos e o recorte de unidades. Histórico de alterações no banco e controle de versão contra sobrescrita de outro usuário.
- Exportação do recorte autorizado em Excel. Conteúdo escrito como texto nas células, preservando zeros de CPF/CNS e evitando execução de fórmulas da fonte.

## Regras dos indicadores

**Recebidos:** linhas de dados válidas dentro do de/para, sem cabeçalho ou linhas vazias. Linhas fora das unidades são informadas separadamente na prévia e no mailing.

**Preenchimento:** situação operacional informada / linhas recebidas. A situação da fonte é descartada; APROVADO não significa preenchimento.

**Conclusão:** AGENDADO, RETIRADO, CIENTE, AGENDADO PELO CALL CENTER e RETIRADO PELO CALL CENTER / linhas recebidas. Tentativas, bloqueio e indisponibilidade seguem pendentes. Essas regras estão explícitas na interface e podem ser ajustadas à rotina da equipe.

**Parado:** caso pendente há 3 dias corridos ou mais desde a última atualização; sem atualização, desde a publicação. O limite é uma regra inicial do produto.

**Médias de contato:** média de dias corridos entre publicação e a data de cada contato, somente nas linhas com aquele contato. Também são exibidas as médias 1º→2º e 2º→3º. Cada média informa sua amostra `n`; contato ausente não vira zero.

**Finalização do caso:** horário em que o status passou a uma situação final, menos a publicação. Reabrir remove a conclusão atual; finalizar novamente cria outro horário. As alterações anteriores permanecem na auditoria.

**Finalização do mailing:** último horário de encerramento quando todas as linhas estão finalizadas, menos a publicação. Para usuários, representa somente seu recorte autorizado. Na produtividade, o prazo da UBS é compartilhado, não atribuído integralmente a uma pessoa. A autoria exibida nas linhas é a última atuação autenticada; o histórico guarda os demais editores. Os tempos são corridos, não horas efetivamente trabalhadas.

## Desenvolvimento local

Requer Node.js 24 e npm. Na raiz do repositório:

```sh
npm ci
npm run db:local
npm run admin:local -- --email=seu@email.com
npm run dev
```

Abra `http://localhost:8765`. O comando administrativo imprime um convite: abra esse link e defina sua senha. Não existe senha padrão nem administrador de demonstração no repositório. Para gerar outro convite do administrador, execute novamente o comando com o mesmo e-mail.

A interface precisa da API; abrir `public/index.html` diretamente mostra uma orientação para iniciar o servidor. O banco local fica em `.wrangler/`, fora do Git. A configuração começa com um ID D1 fictício que permite desenvolvimento local.

```sh
npm test
npm run types
npm run check
```

Os testes verificam cálculos e amostras, Excel, zeros em identificadores, remoção da situação da fonte, autenticação, convites de uso único, acesso por UBS, revogação, conflito entre edições e origem das requisições. O teste de segurança usa o runtime oficial Miniflare com D1 isolado. Também foi feita validação no Edge sobre `wrangler dev`, importando um Excel fictício em uma subpasta de competência variável.

## Publicar no Cloudflare quando chegar a hora

1. Conecte o repositório GitHub ao Workers Builds ou clone-o em uma máquina com Node.js e execute `npm ci`.
2. Autentique: `npx wrangler login`.
3. Crie o banco: `npx wrangler d1 create crm-mailings`. Copie o `database_id` retornado para `wrangler.jsonc`.
4. Defina `vars.APP_ORIGIN` em `wrangler.jsonc` como a URL HTTPS definitiva, sem barra final. A origem do site, convites e API deve coincidir.
5. Aplique a migração: `npm run db:remote`.
6. Valide e publique: `npm test`, `npm run check`, `npm run deploy`.
7. Gere o primeiro convite administrativo: `node scripts/admin.mjs --remote --email=seu@email.com --origin=https://seu-worker.workers.dev`.
8. Abra o convite, defina a senha e cadastre os usuários e suas unidades. Confirme o acesso restrito com um usuário antes de importar dados reais.

O workflow `CI` valida testes e compilação em pushes/PRs. O workflow `Publicar no Cloudflare` é manual e depende dos secrets GitHub `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`, do ID D1 real e de `APP_ORIGIN` configurados. Ele aplica migrações antes do deploy. Uma conta de staging deve usar outro banco e origem, nunca o banco de produção.

## Dados e operação

Senhas usam PBKDF2-SHA-256 com salt aleatório; sessões usam cookies HttpOnly, SameSite=Strict e Secure em HTTPS. Tokens de sessão e convite ficam como hash no banco. Login e ativação têm limite persistido de tentativas. O histórico registra editor, horário e antes/depois. Não há dados de paciente no localStorage.

Os dados de saúde e a auditoria ficam no D1. O Excel original não é arquivado: apenas o hash, os metadados e os campos necessários são persistidos. A importação não altera nem remove as planilhas originais. Limites iniciais: uma aba, 15 MB, 20.000 linhas, 100 MB expandidos. Excel legado `.xls` precisa ser salvo como `.xlsx`.

Um mailing só fica visível quando toda a importação termina. Falhas tratadas removem a carga incompleta; se o processo for interrompido pelo runtime, um lote `loading` pode permanecer oculto. Um administrador técnico pode identificá-lo por `SELECT id,hash FROM lots WHERE status='loading'`, confirmar que a carga não está em andamento e remover somente seus registros e o lote antes de repetir o upload.

Backups do D1, política de retenção da auditoria, perfis institucionais e requisitos de privacidade devem ser definidos na operação. O fluxo de convite e senha, isoladamente, não declara conformidade com a LGPD. Para volumes maiores, a próxima evolução é paginação no servidor e importação assíncrona.

Referências: [Workers e boas práticas](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [D1 e transações em batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Static Assets](https://developers.cloudflare.com/workers/static-assets/binding/).
