# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.0.0](https://github.com/ansibleforms/ansibleforms/compare/6.5.5...7.0.0) (2026-10-10)


### ⚠ BREAKING CHANGES

* entra id on openid-client, pinned to the tenant ([#893](https://github.com/ansibleforms/ansibleforms/issues/893))
* the rte gets each job's secrets sealed from the app ([#887](https://github.com/ansibleforms/ansibleforms/issues/887))
* images run as a non-root user ([#885](https://github.com/ansibleforms/ansibleforms/issues/885))
* playbooks run without the app's environment ([#884](https://github.com/ansibleforms/ansibleforms/issues/884))
* launch validation enforced by default ([#880](https://github.com/ansibleforms/ansibleforms/issues/880))
* runners, app nodes, secret stores and a new interface ([#740](https://github.com/ansibleforms/ansibleforms/issues/740))

### Added

* a click on an awx workflow node opens its output ([#857](https://github.com/ansibleforms/ansibleforms/issues/857)) ([922c356](https://github.com/ansibleforms/ansibleforms/commit/922c3564baa7f956b9f4f83184352de6b0b71d74))
* a content security policy, and a session cookie of the app's own ([#895](https://github.com/ansibleforms/ansibleforms/issues/895)) ([5cad78b](https://github.com/ansibleforms/ansibleforms/commit/5cad78bbc41b3443271547a301cc141495646027))
* a cron's meaning in a popover, and an en dash in the schedules' empty cells ([#806](https://github.com/ansibleforms/ansibleforms/issues/806)) ([a42990b](https://github.com/ansibleforms/ansibleforms/commit/a42990bd52e85b9aaff5d12cd863106b59261992))
* a description on local users and groups ([#798](https://github.com/ansibleforms/ansibleforms/issues/798)) ([2a0ebeb](https://github.com/ansibleforms/ansibleforms/commit/2a0ebeba7a86945e5d0b462e8c4dd7fa2da19fd8))
* a description on roles, and the admin and public roles kept by every save ([#810](https://github.com/ansibleforms/ansibleforms/issues/810)) ([dc3d951](https://github.com/ansibleforms/ansibleforms/commit/dc3d9519b6242a968d9ac8ded4a69b4e5ca8533a))
* a form's title line as the other pages': its help in the info popover, its buttons at the right, a divider, and the grey left column ([#765](https://github.com/ansibleforms/ansibleforms/issues/765)) ([963f58b](https://github.com/ansibleforms/ansibleforms/commit/963f58b77c82eab80494020d53fd45c3d53eacc1))
* a job's output as ansible prints it, without added times ([#861](https://github.com/ansibleforms/ansibleforms/issues/861)) ([003941d](https://github.com/ansibleforms/ansibleforms/commit/003941d082488c78c70c82d3e675189390d71339))
* a new category is filled in a dialog ([#801](https://github.com/ansibleforms/ansibleforms/issues/801)) ([44aaaeb](https://github.com/ansibleforms/ansibleforms/commit/44aaaeb701ed10ca746ae5a3337eb205956a4056))
* a new constant is filled in a dialog ([#800](https://github.com/ansibleforms/ansibleforms/issues/800)) ([ff6b9a8](https://github.com/ansibleforms/ansibleforms/commit/ff6b9a8bdb262751f3dcc435fff9a27a14a2f794))
* a new role is filled in a dialog ([#795](https://github.com/ansibleforms/ansibleforms/issues/795)) ([0ba4362](https://github.com/ansibleforms/ansibleforms/commit/0ba43622b5cbb978d0e6d2823a95a959c9588fb7))
* a page in tabs shows its tab in the title ([#818](https://github.com/ansibleforms/ansibleforms/issues/818)) ([bf81f77](https://github.com/ansibleforms/ansibleforms/commit/bf81f77d2946c6f8f3149a921d2dc42d74bedf44))
* a page per credential, and its row menu as the runners' ([#836](https://github.com/ansibleforms/ansibleforms/issues/836)) ([d5efd13](https://github.com/ansibleforms/ansibleforms/commit/d5efd1359d6840a63442d7fe6b62b479ce0b539a))
* a page per group, with its details and users, and the user and group counts in their lists ([#814](https://github.com/ansibleforms/ansibleforms/issues/814)) ([aad378f](https://github.com/ansibleforms/ansibleforms/commit/aad378f46e427747b29975fdb3a5ee0b037f9392))
* a page per repository, and its row menu grouped with the page's icons ([#827](https://github.com/ansibleforms/ansibleforms/issues/827)) ([fec0acb](https://github.com/ansibleforms/ansibleforms/commit/fec0acb51f07e49642eb48ff76022135cc0964f8))
* a page per role, with its users and groups in tabs, and the roles list as the other tables ([#809](https://github.com/ansibleforms/ansibleforms/issues/809)) ([6a4de2f](https://github.com/ansibleforms/ansibleforms/commit/6a4de2fda1f9500cdb44e06e59b403e339d6d9e1))
* a page per runner, and a runner's registration as a pill, manual when no RTE registered it ([#829](https://github.com/ansibleforms/ansibleforms/issues/829)) ([055008a](https://github.com/ansibleforms/ansibleforms/commit/055008a490779ee17a00fad14634f0db13bde5bf))
* a page per schedule, and the form it runs as a column of the schedules list ([#850](https://github.com/ansibleforms/ansibleforms/issues/850)) ([e5db256](https://github.com/ansibleforms/ansibleforms/commit/e5db256d7d9ceacce23f374d55822eca5d0e94f4))
* a page per secret store, and its row menu as the runners' ([#833](https://github.com/ansibleforms/ansibleforms/issues/833)) ([8ff8565](https://github.com/ansibleforms/ansibleforms/commit/8ff856575a78db8703dd123777f1bee32e6fa288))
* a page per SSO provider, and the link blue on a table's name column ([#817](https://github.com/ansibleforms/ansibleforms/issues/817)) ([bfd46b9](https://github.com/ansibleforms/ansibleforms/commit/bfd46b947c6769e2188edaae74b9f9e7b1b59fd4))
* a page per stored job, opened in its form with its values filled in, and an Add Stored Job wizard ([#852](https://github.com/ansibleforms/ansibleforms/issues/852)) ([9919910](https://github.com/ansibleforms/ansibleforms/commit/9919910c3083d0987a5b160efc32b069941f4ac1))
* a page per user, with its details and groups, several groups per user and the admin user kept ([#813](https://github.com/ansibleforms/ansibleforms/issues/813)) ([f42430d](https://github.com/ansibleforms/ansibleforms/commit/f42430d591b32d37b5fc8425af7db1a8022f60f2))
* a page title of one step a link to the page too ([#807](https://github.com/ansibleforms/ansibleforms/issues/807)) ([3ba47a8](https://github.com/ansibleforms/ansibleforms/commit/3ba47a85d08b0ddabf6293e9076e584b6b3af16a))
* a password policy for local accounts ([#897](https://github.com/ansibleforms/ansibleforms/issues/897)) ([9a1a45f](https://github.com/ansibleforms/ansibleforms/commit/9a1a45f54bf32c67b1f23953fddc1ec4385ea8c3))
* a repository's last output in a bordered box with line numbers, as the server log ([#842](https://github.com/ansibleforms/ansibleforms/issues/842)) ([6fea79f](https://github.com/ansibleforms/ansibleforms/commit/6fea79fd81bc599570785c219d8ffe14f8d210c2))
* a repository's status as a pill, as the audit log's outcomes ([#825](https://github.com/ansibleforms/ansibleforms/issues/825)) ([5fc026a](https://github.com/ansibleforms/ansibleforms/commit/5fc026ad169f8b45718bbcbc30f1b8331455fc90))
* a row that opens something shows its first column in the link blue ([#811](https://github.com/ansibleforms/ansibleforms/issues/811)) ([601640f](https://github.com/ansibleforms/ansibleforms/commit/601640f035faf4f0932add4bbe99939dc588bb34))
* a schedule's next four runs, on one line ([#767](https://github.com/ansibleforms/ansibleforms/issues/767)) ([f23a737](https://github.com/ansibleforms/ansibleforms/commit/f23a7374e2a724a15e7db8ff35fd44c0ddd5841a))
* a schedule's status and state as pills, and its row menu as every list's ([#843](https://github.com/ansibleforms/ansibleforms/issues/843)) ([80b6c5c](https://github.com/ansibleforms/ansibleforms/commit/80b6c5cbf3b5ef43897d4db5117020097066f888))
* a secret store logs in with a credential, and a CyberArk credential type ([#834](https://github.com/ansibleforms/ansibleforms/issues/834)) ([e407641](https://github.com/ansibleforms/ansibleforms/commit/e407641dcc391bb7d4985a4074a9da2fe1f67790))
* an address book icon for LDAP ([#797](https://github.com/ansibleforms/ansibleforms/issues/797)) ([5aa690e](https://github.com/ansibleforms/ansibleforms/commit/5aa690eb38f884a6fad75f7712db1b2c9ccf51a0))
* an Allow MCP role option, apart from the chat assistant ([#796](https://github.com/ansibleforms/ansibleforms/issues/796)) ([3611b39](https://github.com/ansibleforms/ansibleforms/commit/3611b39648916b90506fa8ed48915abba9b9ed01))
* an MCP page under Settings &gt; Connections ([#787](https://github.com/ansibleforms/ansibleforms/issues/787)) ([7ab9353](https://github.com/ansibleforms/ansibleforms/commit/7ab93534c3e34d5d77cb020dfb6eb79e8d7a2467))
* an RTE adds itself as a runner ([#763](https://github.com/ansibleforms/ansibleforms/issues/763)) ([92b9b91](https://github.com/ansibleforms/ansibleforms/commit/92b9b9105d871573a0b20cd8dba7cc2fe6a7d1b9))
* an Unsaved changes dialog when a settings page is left with changes not saved ([#835](https://github.com/ansibleforms/ansibleforms/issues/835)) ([da27197](https://github.com/ansibleforms/ansibleforms/commit/da271970ea9fda10e47a1e06965208f712ad1c16))
* awx launch and end lines in a job's output worded as the rte's ([#855](https://github.com/ansibleforms/ansibleforms/issues/855)) ([dd64773](https://github.com/ansibleforms/ansibleforms/commit/dd6477318ff350f4a9a01a6821d10a337130dbe0))
* checkboxes to delete several rows of a settings list ([#779](https://github.com/ansibleforms/ansibleforms/issues/779)) ([6025ce4](https://github.com/ansibleforms/ansibleforms/commit/6025ce40e73ac2ba47518368a341fc6dc519cf84))
* color theme tones on every blue of the app, and a calmer palette ([#853](https://github.com/ansibleforms/ansibleforms/issues/853)) ([98f5d36](https://github.com/ansibleforms/ansibleforms/commit/98f5d36a71c39e6a81adecab33b6c1408ee6b0ff))
* each step of a page title a link, and a page's tab kept in its url ([#768](https://github.com/ansibleforms/ansibleforms/issues/768)) ([28bf302](https://github.com/ansibleforms/ansibleforms/commit/28bf302ba3c613450f218e6970b36effb4ab13dd))
* entra id on openid-client, pinned to the tenant ([#893](https://github.com/ansibleforms/ansibleforms/issues/893)) ([9603265](https://github.com/ansibleforms/ansibleforms/commit/960326548b1641fcfa1189561adc644802b56e45))
* every pill a solid colour with white text and no border ([#830](https://github.com/ansibleforms/ansibleforms/issues/830)) ([04d883e](https://github.com/ansibleforms/ansibleforms/commit/04d883ed498abf1c496c759a750bae422741234f))
* every slide-in panel a dialog ([#769](https://github.com/ansibleforms/ansibleforms/issues/769)) ([25e10ed](https://github.com/ansibleforms/ansibleforms/commit/25e10ed32ed5cd02e3f8deb914e29bd2c5763f54))
* every table's pager under its card, the rows shown on the left and rounded page boxes with arrows on the right ([#839](https://github.com/ansibleforms/ansibleforms/issues/839)) ([1d9b7b6](https://github.com/ansibleforms/ansibleforms/commit/1d9b7b6a9f637a203c2c18106f1ccd161eab4918))
* every time shown with its zone's short name ([#805](https://github.com/ansibleforms/ansibleforms/issues/805)) ([9a9b78b](https://github.com/ansibleforms/ansibleforms/commit/9a9b78bee0c72bb6cfdd778ffe26e9ea66176475))
* failed logins lock the account and hold back the address ([#890](https://github.com/ansibleforms/ansibleforms/issues/890)) ([3f232e0](https://github.com/ansibleforms/ansibleforms/commit/3f232e0905bc1d41c1adf938c6460d3a772e3f14))
* how many jobs the jobs list loads, a setting in Settings &gt; General &gt; Jobs instead of a dropdown ([#849](https://github.com/ansibleforms/ansibleforms/issues/849)) ([0d972d1](https://github.com/ansibleforms/ansibleforms/commit/0d972d1fd0e95dd5589b7edc3de6766b38c53946))
* how many users a role reaches, in the roles list ([#815](https://github.com/ansibleforms/ansibleforms/issues/815)) ([93e5edf](https://github.com/ansibleforms/ansibleforms/commit/93e5edf5e1b7d2da1cea544e771f3d69b0629763))
* images run as a non-root user ([#885](https://github.com/ansibleforms/ansibleforms/issues/885)) ([756c195](https://github.com/ansibleforms/ansibleforms/commit/756c19529a513bfa029936f7cd066f4fbabffbfb))
* job page redesign, summary, sectioned output with line numbers and folding, awx workflow full screen ([#856](https://github.com/ansibleforms/ansibleforms/issues/856)) ([a55434d](https://github.com/ansibleforms/ansibleforms/commit/a55434d93dda444f754437fba741e926bd506ca8))
* launch validation enforced by default ([#880](https://github.com/ansibleforms/ansibleforms/issues/880)) ([5763be5](https://github.com/ansibleforms/ansibleforms/commit/5763be5e48f6914f422004480549b76f8c0e8b0d))
* launch validation for wizard forms ([#877](https://github.com/ansibleforms/ansibleforms/issues/877)) ([1247b36](https://github.com/ansibleforms/ansibleforms/commit/1247b367c11c58c4e1d34b3eb627c0c403dd0872))
* least-privilege database user ([#886](https://github.com/ansibleforms/ansibleforms/issues/886)) ([eb42185](https://github.com/ansibleforms/ansibleforms/commit/eb421850fbe8adbcc4b042959c9ef9bda84de85a))
* live events, the jobs list, a job's page, the approvals bell and the jobs menu updated as jobs change ([#847](https://github.com/ansibleforms/ansibleforms/issues/847)) ([818fb5b](https://github.com/ansibleforms/ansibleforms/commit/818fb5bf5a48beaaf7446bb01eaccac522f0ea18))
* logout and password changes end tokens, api tokens are bounded ([#892](https://github.com/ansibleforms/ansibleforms/issues/892)) ([2c45c6a](https://github.com/ansibleforms/ansibleforms/commit/2c45c6abdc39cff49a41ff9e02d5271dca6e7bb1))
* no column filter row in the tables, the search on the title line filters them all, Jobs too ([#840](https://github.com/ansibleforms/ansibleforms/issues/840)) ([84ef9fb](https://github.com/ansibleforms/ansibleforms/commit/84ef9fb457c96e2678b5b5c995f0dde8ad208553))
* one darker border grey for every field, card, editor and checkbox in the light theme ([#764](https://github.com/ansibleforms/ansibleforms/issues/764)) ([a273663](https://github.com/ansibleforms/ansibleforms/commit/a2736631545e1b6f1a3687580968146e007229a4))
* one row hover grey for every table, and a list's blue name underlined on hover ([#844](https://github.com/ansibleforms/ansibleforms/issues/844)) ([07004e1](https://github.com/ansibleforms/ansibleforms/commit/07004e1fecd8b8c585f95d33f37f9288f125b826))
* one status pill for a job wherever it shows, its page and a form's running job too ([#845](https://github.com/ansibleforms/ansibleforms/issues/845)) ([1049bde](https://github.com/ansibleforms/ansibleforms/commit/1049bde9e7a5fcaf5808b80dd0f6bbce8cd12cf4))
* one table layout across the app: framed tables, their toolbar on the title line, column presets and the rows shown ([#773](https://github.com/ansibleforms/ansibleforms/issues/773)) ([02cebfc](https://github.com/ansibleforms/ansibleforms/commit/02cebfcc99ce63a388d332cb29389f27dec19e4d))
* pager border and disabled state, help menu icons ([#854](https://github.com/ansibleforms/ansibleforms/issues/854)) ([da7237b](https://github.com/ansibleforms/ansibleforms/commit/da7237b3f4d3939fc06fddd4efafb6bb9e4a3bbf))
* roles limit the credentials, secret stores and runners a user may use ([#888](https://github.com/ansibleforms/ansibleforms/issues/888)) ([9068d63](https://github.com/ansibleforms/ansibleforms/commit/9068d635fe43f4a3552ae805cf36a76b464597ae))
* run later under launch validation enforce ([#879](https://github.com/ansibleforms/ansibleforms/issues/879)) ([adcf10f](https://github.com/ansibleforms/ansibleforms/commit/adcf10fd006f8cce8101fce81a29a2cecfd58033))
* runners, app nodes, secret stores and a new interface ([#740](https://github.com/ansibleforms/ansibleforms/issues/740)) ([38dee92](https://github.com/ansibleforms/ansibleforms/commit/38dee9230377b8e66c89c1b51022a706da71ea5c))
* several mail servers, one active, each with its own page, and an SMTP credential type ([#837](https://github.com/ansibleforms/ansibleforms/issues/837)) ([031e867](https://github.com/ansibleforms/ansibleforms/commit/031e8678b445a1452b972ff5845fbdd53e2f5144))
* the backup command timeout applies without a restart ([#766](https://github.com/ansibleforms/ansibleforms/issues/766)) ([34b86b7](https://github.com/ansibleforms/ansibleforms/commit/34b86b7a80ec83e8e6be11a70f013b0bbc7743e5))
* the blue pill a pure blue, not Bootstrap's violet-leaning one ([#848](https://github.com/ansibleforms/ansibleforms/issues/848)) ([feb9c71](https://github.com/ansibleforms/ansibleforms/commit/feb9c712fb89ba9399d27d91808d8998f33058f1))
* the chat assistant page in tabs, with an on/off switch that needs no restart ([#789](https://github.com/ansibleforms/ansibleforms/issues/789)) ([f9231e7](https://github.com/ansibleforms/ansibleforms/commit/f9231e7f86f4ec3659682a208e76d9e96ed80132))
* the chat assistant's API key from an api credential ([#838](https://github.com/ansibleforms/ansibleforms/issues/838)) ([a1c6c06](https://github.com/ansibleforms/ansibleforms/commit/a1c6c0691e187827cdda936ecce5b8ad2002d299))
* the config seed reload interval applied without a restart ([#812](https://github.com/ansibleforms/ansibleforms/issues/812)) ([501bd7e](https://github.com/ansibleforms/ansibleforms/commit/501bd7efaf80bd84105f3f10e6b62e740e5f6faa))
* the credential dialog as a wizard ([#790](https://github.com/ansibleforms/ansibleforms/issues/790)) ([7863ff4](https://github.com/ansibleforms/ansibleforms/commit/7863ff4ba040bc30c570f94b7086400ea4da65f6))
* the days of server log files kept in Settings &gt; Retention, and two more settings applied without a restart ([#826](https://github.com/ansibleforms/ansibleforms/issues/826)) ([f0f1719](https://github.com/ansibleforms/ansibleforms/commit/f0f171967f876c443d690dcabd653cb1babf89e0))
* the default admin password must be changed at first login ([#891](https://github.com/ansibleforms/ansibleforms/issues/891)) ([f7f334c](https://github.com/ansibleforms/ansibleforms/commit/f7f334c14fff00f8475dd32722c198da394f8992))
* the designer's card in tabs, visual editors for categories and constants, previews for forms and categories ([#868](https://github.com/ansibleforms/ansibleforms/issues/868)) ([cf9423f](https://github.com/ansibleforms/ansibleforms/commit/cf9423ff90e11276f9977871ee46d1aa02beb06c))
* the form page's run as the job page shows it, followed live, with its bar at the window's bottom ([#860](https://github.com/ansibleforms/ansibleforms/issues/860)) ([f5fae86](https://github.com/ansibleforms/ansibleforms/commit/f5fae86645b6f53365ecb3c336a65b20ce2a34e5))
* the form's close output button with an up arrow ([#862](https://github.com/ansibleforms/ansibleforms/issues/862)) ([94a022f](https://github.com/ansibleforms/ansibleforms/commit/94a022ffcba16b052dc2b7550b0d7c81d1d1147a))
* the jobs list with status pills, checkboxes, a row menu and a Time column, fitted to its frame ([#841](https://github.com/ansibleforms/ansibleforms/issues/841)) ([08add30](https://github.com/ansibleforms/ansibleforms/commit/08add30780fc3cb4d673ee882035883896384c89))
* the jobs list's Duration column, and its Refresh button at the far right ([#846](https://github.com/ansibleforms/ansibleforms/issues/846)) ([422aa0c](https://github.com/ansibleforms/ansibleforms/commit/422aa0c0f178101462029e1c9833b938b6216260))
* the jobs of a status at /jobs/&lt;status&gt; ([#870](https://github.com/ansibleforms/ansibleforms/issues/870)) ([bef3313](https://github.com/ansibleforms/ansibleforms/commit/bef3313c94a9489aaea6a2ac06b7919b5f9427fb))
* the LDAP page in tabs, with its switch titled and described as on the MCP page ([#791](https://github.com/ansibleforms/ansibleforms/issues/791)) ([a41890f](https://github.com/ansibleforms/ansibleforms/commit/a41890f6ce7551790e3d0b4a9d9b822db8553e1b))
* the left menus steady between pages: the forms menu on a form, drawn at once, with one badge style ([#772](https://github.com/ansibleforms/ansibleforms/issues/772)) ([de9aa40](https://github.com/ansibleforms/ansibleforms/commit/de9aa40005c8516aff995a46c0a5a2c1ec8c7673))
* the login's single sign-on as a centred row of branded provider buttons ([#863](https://github.com/ansibleforms/ansibleforms/issues/863)) ([24ce8e1](https://github.com/ansibleforms/ansibleforms/commit/24ce8e1235836dc92ba9726c3e81cf7fbfb981ad))
* the OAuth2 page renamed SSO, with one icon in the menu and the title ([#794](https://github.com/ansibleforms/ansibleforms/issues/794)) ([28828f5](https://github.com/ansibleforms/ansibleforms/commit/28828f56c036207e5ff59121c0ce6a6662fde1a6))
* the OAuth2 provider dialog as a wizard, with each provider's help in its steps ([#793](https://github.com/ansibleforms/ansibleforms/issues/793)) ([714ff69](https://github.com/ansibleforms/ansibleforms/commit/714ff6966738b0b984a053d8f75dcbc8bee5bcf4))
* the page buttons at the top right corner, blue add buttons, and the tabs framed in the cards' grey ([#770](https://github.com/ansibleforms/ansibleforms/issues/770)) ([3022dd7](https://github.com/ansibleforms/ansibleforms/commit/3022dd7d4ce03e0e53403f5fe634a0f7e90f7651))
* the repositories table's columns close together, left out on a narrow table, and a tidier Columns menu ([#831](https://github.com/ansibleforms/ansibleforms/issues/831)) ([2fd6e3e](https://github.com/ansibleforms/ansibleforms/commit/2fd6e3e295d2527648657dc034086f8c4dd48fb1))
* the repository dialog as a wizard ([#788](https://github.com/ansibleforms/ansibleforms/issues/788)) ([fd23413](https://github.com/ansibleforms/ansibleforms/commit/fd23413d2a7d607b8c052d651ee05ea5b0d9299a))
* the rte gets each job's secrets sealed from the app ([#887](https://github.com/ansibleforms/ansibleforms/issues/887)) ([2eb1ae7](https://github.com/ansibleforms/ansibleforms/commit/2eb1ae797baf2f2922177eb6bf9dd041efbad80c))
* the runner dialog as a wizard, and the default runners in a dialog of their own ([#782](https://github.com/ansibleforms/ansibleforms/issues/782)) ([4c26202](https://github.com/ansibleforms/ansibleforms/commit/4c2620208425852c84bdebe5fd583fc7ccd2dc06))
* the schedule dialog as a wizard, with the next run in the table ([#803](https://github.com/ansibleforms/ansibleforms/issues/803)) ([50aa363](https://github.com/ansibleforms/ansibleforms/commit/50aa3634fa5224a81fe6a6ed11b060bb840c7d32))
* the secret store dialog as a wizard ([#786](https://github.com/ansibleforms/ansibleforms/issues/786)) ([5dc64fd](https://github.com/ansibleforms/ansibleforms/commit/5dc64fd0e3e465d14761db93d56c15966612c0a3))
* the server log's filter as the other search boxes, and Refresh as a labelled button ([#776](https://github.com/ansibleforms/ansibleforms/issues/776)) ([4bf5a11](https://github.com/ansibleforms/ansibleforms/commit/4bf5a11f38bce9831f4ce67ace39ccec1a92fb87))
* the settings pages under /settings ([#869](https://github.com/ansibleforms/ansibleforms/issues/869)) ([ab91351](https://github.com/ansibleforms/ansibleforms/commit/ab91351a5af0bcb17bf82a7087ac00000f139884))
* the SSO page in General and Providers tabs, with single sign-on switched as a whole ([#816](https://github.com/ansibleforms/ansibleforms/issues/816)) ([3a745f4](https://github.com/ansibleforms/ansibleforms/commit/3a745f49f39197e05c8daf3d907a598706b01552))
* the user dialog as a wizard, and a search box on the group column ([#799](https://github.com/ansibleforms/ansibleforms/issues/799)) ([3867a6b](https://github.com/ansibleforms/ansibleforms/commit/3867a6b412f77b5d9c30ef2a0b9f6a2c830272f9))


### Fixed

* a connection check sends the stored password to the stored server only ([#883](https://github.com/ansibleforms/ansibleforms/issues/883)) ([baa81be](https://github.com/ansibleforms/ansibleforms/commit/baa81be630c8fb24826cd35692681be682dd6725))
* a cron's words read as a repeating schedule ([#865](https://github.com/ansibleforms/ansibleforms/issues/865)) ([fea94a7](https://github.com/ansibleforms/ansibleforms/commit/fea94a7ff401da036127fd754e0ee4042ad13857))
* a dropdown of records shows their names in every layout ([#832](https://github.com/ansibleforms/ansibleforms/issues/832)) ([6b13d56](https://github.com/ansibleforms/ansibleforms/commit/6b13d567d68b6e70f2f36f809e67451ff0a33ccb))
* a form's card as much room over its first fields as under its last ([#858](https://github.com/ansibleforms/ansibleforms/issues/858)) ([46a84b8](https://github.com/ansibleforms/ansibleforms/commit/46a84b836dd60f53f5e9c96eb0adac83e81f3346))
* a form's help opened on a click only ([#771](https://github.com/ansibleforms/ansibleforms/issues/771)) ([6d7b82e](https://github.com/ansibleforms/ansibleforms/commit/6d7b82e99025bc4700c5f73ad5737d7859692478))
* a form's status icons as far under its title line as above the form ([#762](https://github.com/ansibleforms/ansibleforms/issues/762)) ([154722b](https://github.com/ansibleforms/ansibleforms/commit/154722b59df42261c17cee93fbc65ac366a5fe30))
* a job ends once, whoever races to end it ([#898](https://github.com/ansibleforms/ansibleforms/issues/898)) ([0ba2c4e](https://github.com/ansibleforms/ansibleforms/commit/0ba2c4ecd89c520bcea21fedba93fc0073870500))
* a masked secret sent back on an update keeps the stored one ([#882](https://github.com/ansibleforms/ansibleforms/issues/882)) ([980251d](https://github.com/ansibleforms/ansibleforms/commit/980251d3dfdaaa4349d24382d0e85ce3fa0146dc))
* a repository's schedule and credential cleared when saved empty, and form validation set up with the form ([#759](https://github.com/ansibleforms/ansibleforms/issues/759)) ([443c429](https://github.com/ansibleforms/ansibleforms/commit/443c429a9a235a20e34026df5183b5950677ff42))
* a tabbed card ends at its padding when its tabs are wrapped in a div ([#784](https://github.com/ansibleforms/ansibleforms/issues/784)) ([64c05ba](https://github.com/ansibleforms/ansibleforms/commit/64c05babd7cbbb874b2ebdc80535c009ebea575c))
* a table's checkboxes shown whole however narrow the table ([#777](https://github.com/ansibleforms/ansibleforms/issues/777)) ([2589f36](https://github.com/ansibleforms/ansibleforms/commit/2589f36ecc6af6ac70bccb3e352678df30c018a0))
* a wizard job keeps its step drafts ([#878](https://github.com/ansibleforms/ansibleforms/issues/878)) ([846f5b2](https://github.com/ansibleforms/ansibleforms/commit/846f5b290d3dec670ae1b02d53d0d1a5a3593c3d))
* an en dash in the config seed column for a row the seed does not manage ([#823](https://github.com/ansibleforms/ansibleforms/issues/823)) ([6165abd](https://github.com/ansibleforms/ansibleforms/commit/6165abdd7421ff8b4c9d4211ccdb1fbc92da0350))
* an SSH key saved where its folder does not exist yet, and its real error reported ([#819](https://github.com/ansibleforms/ansibleforms/issues/819)) ([0546d02](https://github.com/ansibleforms/ansibleforms/commit/0546d02df010961e2e5bc9e20994b839a6c9f088))
* dates read from the database as UTC, whatever the server's timezone ([#804](https://github.com/ansibleforms/ansibleforms/issues/804)) ([7dc46c8](https://github.com/ansibleforms/ansibleforms/commit/7dc46c8ebc5390c421c74bd19f84b2e069041556))
* drop launch credentials the form does not declare ([#876](https://github.com/ansibleforms/ansibleforms/issues/876)) ([a9e5035](https://github.com/ansibleforms/ansibleforms/commit/a9e5035ae629077aa3a55f60a43c0e204155f6a6))
* drop the v6.1.5 callback URL notice from the OIDC page ([#792](https://github.com/ansibleforms/ansibleforms/issues/792)) ([e06ad25](https://github.com/ansibleforms/ansibleforms/commit/e06ad253070c47b8852ee312643a011e9e12c4f8))
* form values passed to playbooks as text, never as jinja templates ([#874](https://github.com/ansibleforms/ansibleforms/issues/874)) ([f14554e](https://github.com/ansibleforms/ansibleforms/commit/f14554ee857f6fc9688062295c24c8a5df92f9ce))
* honour a __playbook__ field inside a wizard step ([#756](https://github.com/ansibleforms/ansibleforms/issues/756)) ([622b37d](https://github.com/ansibleforms/ansibleforms/commit/622b37de5e7837baf09a900ce9a0003d216c815f))
* no dot beside the checkboxes of a table's rows ([#780](https://github.com/ansibleforms/ansibleforms/issues/780)) ([61277a4](https://github.com/ansibleforms/ansibleforms/commit/61277a49b7f1698240ffe6f04a484f5796f5297a))
* no extra space at the bottom of a settings card ending with switches ([#761](https://github.com/ansibleforms/ansibleforms/issues/761)) ([3d594aa](https://github.com/ansibleforms/ansibleforms/commit/3d594aa5a744980d4e4fd085a0bd903bf96778e7))
* no space before a colon in the interface's text, French aside ([#808](https://github.com/ansibleforms/ansibleforms/issues/808)) ([2ef6a74](https://github.com/ansibleforms/ansibleforms/commit/2ef6a74096fea0af99be1d2da82d3da55752896c))
* only an admin grants admin or changes the roles ([#889](https://github.com/ansibleforms/ansibleforms/issues/889)) ([cad481b](https://github.com/ansibleforms/ansibleforms/commit/cad481b9ae572f21c5be50fee1e292c175abe10b))
* playbooks run without the app's environment ([#884](https://github.com/ansibleforms/ansibleforms/issues/884)) ([780d95e](https://github.com/ansibleforms/ansibleforms/commit/780d95ec46326a0e3c5817437fc520cadb7083b4))
* remove the runners of stopped RTEs ([#785](https://github.com/ansibleforms/ansibleforms/issues/785)) ([727deff](https://github.com/ansibleforms/ansibleforms/commit/727defff51a0fd03bc869a9e5454ae122cf257b9))
* rte replicas behind one address no longer lose running jobs ([#899](https://github.com/ansibleforms/ansibleforms/issues/899)) ([f810c38](https://github.com/ansibleforms/ansibleforms/commit/f810c38cbeeafbbd8a201cd4dec7a01c489b33f1))
* secrets masked in job output ([#881](https://github.com/ansibleforms/ansibleforms/issues/881)) ([36201d9](https://github.com/ansibleforms/ansibleforms/commit/36201d90b1e583ad5cf78f0a8880682571208f7a))
* server expressions evaluated from the form definition ([#873](https://github.com/ansibleforms/ansibleforms/issues/873)) ([f3c1ecf](https://github.com/ansibleforms/ansibleforms/commit/f3c1ecfb7de736781f1dbf53a1091b5a0a5368bc))
* the api docs no longer ask for a stylesheet that is gone ([#896](https://github.com/ansibleforms/ansibleforms/issues/896)) ([a1282ec](https://github.com/ansibleforms/ansibleforms/commit/a1282ecc3a50b3b30a3c97dfd55101c6a13845d5))
* the audit log names the record an update or a delete was about, and a wider actor column ([#821](https://github.com/ansibleforms/ansibleforms/issues/821)) ([3671721](https://github.com/ansibleforms/ansibleforms/commit/3671721f5de29d8352f9d56fc91e94a937cdb69b))
* the chat's job status setting a switch with its title, as the others ([#820](https://github.com/ansibleforms/ansibleforms/issues/820)) ([ce1b3d3](https://github.com/ansibleforms/ansibleforms/commit/ce1b3d3f89ac454715990f8aab3e72153d7dbe22))
* the color theme's primary buttons in the color picked ([#859](https://github.com/ansibleforms/ansibleforms/issues/859)) ([17d151f](https://github.com/ansibleforms/ansibleforms/commit/17d151fc69e2772130e4950de7f1ab2c62d064ef))
* the config seed's help on one line in the default runners dialog ([#828](https://github.com/ansibleforms/ansibleforms/issues/828)) ([b79243d](https://github.com/ansibleforms/ansibleforms/commit/b79243dd3aa373dbe8b20f4f71d85ef4834fd68d))
* the constants, categories and roles lists framed as the other tables ([#802](https://github.com/ansibleforms/ansibleforms/issues/802)) ([9189eba](https://github.com/ansibleforms/ansibleforms/commit/9189eba0c2c70be2e86ffe4104edbe2ca432d1a9))
* the cron column's popover without the browser's tooltip too ([#864](https://github.com/ansibleforms/ansibleforms/issues/864)) ([dac28b3](https://github.com/ansibleforms/ansibleforms/commit/dac28b3b9b79648016472f18d2af734da90815e1))
* the designer not started titled inactive, with an open lock ([#866](https://github.com/ansibleforms/ansibleforms/issues/866)) ([448c1a5](https://github.com/ansibleforms/ansibleforms/commit/448c1a5f88e3b41217cd359349c15e897f94372f))
* the designer's loading indicator centered in its card ([#774](https://github.com/ansibleforms/ansibleforms/issues/774)) ([0431dd0](https://github.com/ansibleforms/ansibleforms/commit/0431dd04310e15349497a67559efa55261ec1edb))
* the designer's previews the card's height ([#872](https://github.com/ansibleforms/ansibleforms/issues/872)) ([36ee498](https://github.com/ansibleforms/ansibleforms/commit/36ee4984c2a595f204e08a638f28aaed7fc7a48e))
* the empty jobs table's message centred in its row ([#871](https://github.com/ansibleforms/ansibleforms/issues/871)) ([28c44ef](https://github.com/ansibleforms/ansibleforms/commit/28c44ef6d9ee0e4ce44dcba3c18ebf97604ca319))
* the header's Settings link active on every settings page, and the server log under /admin ([#822](https://github.com/ansibleforms/ansibleforms/issues/822)) ([fca6e3b](https://github.com/ansibleforms/ansibleforms/commit/fca6e3b8db8b7cba98374d62d7944c2d78cdce79))
* the Run now button starts an idle schedule, queued first as the cron trigger does ([#851](https://github.com/ansibleforms/ansibleforms/issues/851)) ([c6a6648](https://github.com/ansibleforms/ansibleforms/commit/c6a664869c20de15f6a44b37c0706fe01ce5eb1e))
* the runners page laid out as the other settings pages ([#775](https://github.com/ansibleforms/ansibleforms/issues/775)) ([ab451fd](https://github.com/ansibleforms/ansibleforms/commit/ab451fd4850a5597478395294a710c0a34348d8d))
* the runners' Default column as wide as its header ([#778](https://github.com/ansibleforms/ansibleforms/issues/778)) ([015100e](https://github.com/ansibleforms/ansibleforms/commit/015100e6c7aabf2b0fb52bfde600f40cf19ade46))
* the secret store name's help on one line ([#824](https://github.com/ansibleforms/ansibleforms/issues/824)) ([4911e5d](https://github.com/ansibleforms/ansibleforms/commit/4911e5d101f91ca5276492176fa41a6d24ea9fef))
* the server log's line numbers from the card's border, its scrollbar inside the card's corners ([#760](https://github.com/ansibleforms/ansibleforms/issues/760)) ([7be0125](https://github.com/ansibleforms/ansibleforms/commit/7be0125662e8d1bfc7069a7d0efd7c30ce377c99))
* the sso handoff travels in the fragment and is taken once ([#894](https://github.com/ansibleforms/ansibleforms/issues/894)) ([3c072f3](https://github.com/ansibleforms/ansibleforms/commit/3c072f3a6d8af67e593cd3c7d368cdf935038157))
* the title line's controls wrapping as one, under the title when they do not fit ([#781](https://github.com/ansibleforms/ansibleforms/issues/781)) ([5c1ced1](https://github.com/ansibleforms/ansibleforms/commit/5c1ced11896764faa4e9b807a68195ffeeecd174))

## [6.5.5](https://github.com/ansibleforms/ansibleforms/compare/6.5.4...6.5.5) (2026-10-06)


### Fixed

* correct the ldap group search and entra id group hints ([#705](https://github.com/ansibleforms/ansibleforms/issues/705)) ([07dcc31](https://github.com/ansibleforms/ansibleforms/commit/07dcc3127ab5532c4e3979d90fea99ec82a94dd4))
* **oidc:** apply the group filter to the groups in the token ([#703](https://github.com/ansibleforms/ansibleforms/issues/703)) ([c2dac5d](https://github.com/ansibleforms/ansibleforms/commit/c2dac5d66c94993c9f77096600bb8e4d97853ab1))
* stop the running step when a multistep job is aborted ([#702](https://github.com/ansibleforms/ansibleforms/issues/702)) ([3d335c5](https://github.com/ansibleforms/ansibleforms/commit/3d335c504b9d7ce32046b3e9d83bec65fbfa451b))


### Security

* only show users their own stored jobs ([#700](https://github.com/ansibleforms/ansibleforms/issues/700)) ([bdaa43f](https://github.com/ansibleforms/ansibleforms/commit/bdaa43fed10c0f0081ef7941bcebe44b7c387375))
* stop other users from deleting a job awaiting approval ([#699](https://github.com/ansibleforms/ansibleforms/issues/699)) ([1e038f6](https://github.com/ansibleforms/ansibleforms/commit/1e038f6f4c185f0388b40eef20a9c9a240716c14))

## [6.5.4](https://github.com/ansibleforms/ansibleforms/compare/6.5.3...6.5.4) (2026-10-05)


### Changed

* **server:** write the key separators as \0 escapes ([#650](https://github.com/ansibleforms/ansibleforms/issues/650)) ([41a8015](https://github.com/ansibleforms/ansibleforms/commit/41a8015e93053c82bd7306b999e5cbe570d10788))

## [6.5.3](https://github.com/ansibleforms/ansibleforms/compare/6.5.2...6.5.3) (2026-10-05)


### Fixed

* **client:** build without warnings ([#632](https://github.com/ansibleforms/ansibleforms/issues/632)) ([97f6c95](https://github.com/ansibleforms/ansibleforms/commit/97f6c955e755151b05dfc0568dc25c17f00e77d0))

## [6.5.2](https://github.com/ansibleguy76/ansibleforms/compare/6.5.1...6.5.2) (2026-10-01)


### Fixed

* sidebar sections open one at a time, real examples in the chat welcome, scm_branch is sent to AWX ([#549](https://github.com/ansibleguy76/ansibleforms/issues/549)) ([1991e63](https://github.com/ansibleguy76/ansibleforms/commit/1991e6338940c6ce55fc3328abb8092d1c516c9c))
* the Azure AD login reads the groups from Microsoft Graph on the server ([#552](https://github.com/ansibleguy76/ansibleforms/issues/552)) ([79ed42b](https://github.com/ansibleguy76/ansibleforms/commit/79ed42b6a5b61bedc69321df4e79d9fc847c8804))

## [6.5.1](https://github.com/ansibleguy76/ansibleforms/compare/6.5.0...6.5.1) (2026-09-30)


### Fixed

* **chat:** ignore certificate errors for a self-signed proxy, and say why a provider cannot be reached ([#546](https://github.com/ansibleguy76/ansibleforms/issues/546)) ([278f690](https://github.com/ansibleguy76/ansibleforms/commit/278f690be1f083ee519bd129620793c911e43d8e))

## [6.5.0](https://github.com/ansibleguy76/ansibleforms/compare/6.4.1...6.5.0) (2026-09-30)


### Added

* chat assistant - fill in and launch forms by talking (Anthropic, OpenAI and compatible) ([#544](https://github.com/ansibleguy76/ansibleforms/issues/544)) ([255ad8a](https://github.com/ansibleguy76/ansibleforms/commit/255ad8a131111a023116c25b9ec0d33416daeed9))

## [6.4.1](https://github.com/ansibleguy76/ansibleforms/compare/6.4.0...6.4.1) (2026-09-30)


### Fixed

* an uploaded svg logo without width and height is shown ([#540](https://github.com/ansibleguy76/ansibleforms/issues/540)) ([fb56d62](https://github.com/ansibleguy76/ansibleforms/commit/fb56d6245a508b6836e14e0cf619bba696d688b0))
* server-side launch validation - server-built extravars, list rows, per-form launchValidation, relaunch with changes ([#537](https://github.com/ansibleguy76/ansibleforms/issues/537)) ([81f2f50](https://github.com/ansibleguy76/ansibleforms/commit/81f2f505ff5013b182c72ff020e9ae9e8f56f76b))
* the Azure AD login no longer fails on the handoff token ([#543](https://github.com/ansibleguy76/ansibleforms/issues/543)) ([af0d7b0](https://github.com/ansibleguy76/ansibleforms/commit/af0d7b02eacbc4e60c3d3999f90c97039aa8fd85))

## [6.4.0](https://github.com/ansibleguy76/ansibleforms/compare/6.3.1...6.4.0) (2026-09-29)


### Added

* mcp server for ai agents ([#534](https://github.com/ansibleguy76/ansibleforms/issues/534)) ([d7520f4](https://github.com/ansibleguy76/ansibleforms/commit/d7520f472d9a68fbe0498181ec0301c34b96955b))
* one set of form validation rules for the browser, MCP and the launch API ([#535](https://github.com/ansibleguy76/ansibleforms/issues/535)) ([4d429c2](https://github.com/ansibleguy76/ansibleforms/commit/4d429c2ea97889bcdd89adf89e2edee245343c04))

## [6.3.1](https://github.com/ansibleguy76/ansibleforms/compare/6.3.0...6.3.1) (2026-09-25)


### Fixed

* legacy expression sanitizer no longer logs an abuse error for expressions it runs ([#524](https://github.com/ansibleguy76/ansibleforms/issues/524)) ([e3e1814](https://github.com/ansibleguy76/ansibleforms/commit/e3e1814d4384d1dfe2c5baca334567f1ef370dac))

## [6.3.0] - 2026-09-25

### Added

-   Declarative config seed (`CONFIG_SEED_PATH`) — rebuild an instance from a yaml file. See `docs/seed.md`
-   An empty database creates its own schema at startup
-   Audit trail (`/admin/audit`) — append-only, and secrets are never stored
-   Status page (`/admin/status`)
-   Job and job output retention (`JOB_RETENTION_DAYS`), off by default
-   Visual editors for Categories, Roles and Constants. Comments and anchors survive a save
-   The config source is switchable from the UI (`config_source`) — file or database
-   A HashiCorp Vault page, with a read-only connection test
-   Environment variables are editable from the settings page, saved to `persistent/.env`
-   Config API — read, write, import, export and convert. See `GET /api/v2/docs`
-   The designer was rebuilt — a file tree, and buttons instead of raw YAML
-   The settings pages were rebuilt — tabbed, with per-field help
-   Server-wide default language and theme, plus a Color theme
-   A visual cron editor with presets and a next-runs preview
-   Schedules can be created from the admin UI
-   `GIT_PUSH_COMMAND` env var added, to customize the command used when pushing git repositories
-   Group filter for LDAP (admin panel > LDAP > Group Filter). A regular expression matched against the group name, the same one Entra ID and OIDC already have — only matching groups are kept, mapped to roles and sent to playbooks. Empty keeps every group, which is what every existing installation does today. A pattern that does not compile is logged and ignored rather than stripping everyone's roles
-   `EXTRAVARS_USER_FIELDS` env var and the `userExtravars` form property, to choose which keys of the launching user are sent to the playbook as `ansibleforms_user`. Empty keeps the whole object, as before; a comma separated list keeps only those keys and `none` sends nothing. The form property overrides the environment variable. The frontend `__user__` object and every permission check are unaffected. See `docs/faq.md`
-   The config seed is re-applied when the file changes (`CONFIG_SEED_RELOAD_SECONDS`, 60s by default), so a seed edited in git reaches a running instance without restarting it. `POST /api/v2/config-seed/apply` and `SIGHUP` force an apply immediately. A failed reload is never fatal: the configuration already in force is kept and the Status page reports it. See `docs/seed.md`
-   `EXPRESSION_SANITIZER` env var, to choose how strictly server expressions (without `runLocal`) are checked: `off` refuses every server expression, `paranoid` allows only direct `fn.`/`fnc.` calls, `strict` (default) also allows methods on their result, and `legacy` restores the 6.2.1 rules. `legacy` lets any authenticated user run code on the server, so it can only be set in the real environment (not from the settings page), logs a warning at startup and for every expression `strict` would refuse, and shows as a warning on the Status page
-   Categories can be moved around the tree — move up, move down, indent and outdent, in the settings Categories page and in the designer, taking the whole subtree along
-   Constants can hold a list or a nested object — the value box in the designer and on the settings page is read as YAML, so a block list, a list of objects and a nested map are stored as such instead of as their source text

### Changed

-   Permission failures answer `403` instead of `401`
-   `PUT /api/v2/settings/` is now a partial update
-   The settings menu has five sections: System, Forms, Access, Connections, Jobs
-   Menu entries your role cannot open are hidden
-   The designer works when the config lives in the database
-   Backup and restore follow the active config source
-   LDAP loses its Advanced toggle — the four group fields always apply

### Removed

-   LDAP `is_advanced` toggle. On upgrade the fields are blanked where it was off, old values logged first

### Fixed

-   A designer save deleted form files the loader had skipped
-   A repository named `forms` treated its whole root as a forms folder, so a save deleted unrelated yaml files
-   Approving a job twice at once launched it twice
-   A multistep step whose status could not be read counted as passed
-   A failed backup listed as a valid restore point
-   Restoring a backup with no usable dump reported success
-   `NIGHTLY_BACKUP_RETENTION=0` deleted every nightly backup
-   The designer could silently overwrite a form — ids were reused
-   Designer saves wrote to the local `config.yaml` while the app read a repository
-   The designer overwrote a ytt-templated config with its rendered output
-   Designer edits were discarded when navigating away or reloading
-   The "Show Extravars" role option never took effect — two spellings
-   A login with no `Authorization: Basic` header hung for ever, leaking a socket
-   A `401` surviving a token refresh looped refresh and retry
-   `LOG_SYSLOG_PROTOCOL` never had any effect — misspelt read, so syslog always used UDP
-   MongoDB datasource queries always failed
-   Query fields inside a wizard step or list row failed for everyone except an admin
-   Query placeholders with dot notation, an index path or `placeholderColumn` stopped working
-   Query values were escaped with MySQL's rules on every datasource, corrupting backslashes and quotes
-   Renaming a repository moved its working tree before the change was written, orphaning it if refused
-   A cron schedule with an inverted range (`0 0 * * 5-1`) saved and never ran
-   An invalid `MASK_EXTRAVARS_REGEX` or `REGEX_FILTER_JOB_OUTPUT` broke job launching and made every job unviewable
-   Bulk delete on Known Hosts removed the wrong entries — rows were keyed by position
-   `OLD_BACKUP_DAYS=0` deleted every config restore point. It now keeps everything
-   `GET /api/v2/repository/<name>` kept answering with the `head` from before a pull for up to an hour. The repositories model is cached and `findByName` reads that cache, while the git operations wrote `status`, `output` and `head` with their own SQL and evicted nothing — so the single record disagreed with `GET /api/v2/repository` and with the database. Anything polling it to learn whether a commit had landed waited on a value that could not change
-   Wizard didn't load varsFiles
-   `target="_blank"` was stripped from links in `html` and `expression` fields, so they opened in the current tab and the form was lost (#480). `rel="noopener noreferrer"` is now forced on any link that opens a new tab
-   Startup failed with `Failed to create the path for the log files` when `LOG_PATH`'s parent folder did not exist — the folder is now created recursively
-   Prefill bug (relaunch and load from form)
-   Designer: while a form's YAML was invalid - halfway through typing any line - the form jumped to a "Parsing issues" group in the tree and the editor was rebuilt, losing the cursor and focus

### Security

-   A user without verbose permission could relaunch a verbose job and get its output
-   Server-side expressions could break out of the evaluator and run commands — the guard only checked how one started
-   A form you had no access to appeared on the home page when two files shared a name
-   A server expression reached banned names through string property keys (`fn.x['constructor']`) — arbitrary code execution for any signed-in user
-   A group name containing HTML ran as script in the users list
-   Opening another user's job answered 200 with an empty body instead of refusing, and approve/reject skipped its role check
-   A `git pull` that could not read its repository record published the stored password
-   `/api/v1/query` accepted arbitrary SQL, bypassing the v2 guard
-   Form load warnings rendered the form name as HTML on the home page
-   A failed login revealed whether the username existed
-   Changing a password needed no proof of the current one
-   The query endpoint ran any SQL from the request body, with only a login required
-   A field value reached a form expression as raw text, so a crafted link ran script
-   Refresh tokens were never verified, re-checked or retired
-   Anyone could sign in as any user, including admin, through the SSO endpoints
-   Reserved extravars from the request beat the form, so any playbook could run with any credential. A `__x__` key is now accepted only when the form declares a field of that name
-   Any authenticated user could abort any other user's job
-   An AWX workflow node name ran as script in the job output
-   Dropdown option values rendered unescaped while the search box was empty
-   The `ansible-vault` password was written to the log in full
-   `VAULT_TOKEN` was returned in clear text to any user with `showSettings`
-   The v2 log endpoints had no permission check
-   A duplicate role name in `config.yaml` granted its rights twice over
-   The backup's environment filter missed `export NAME=value`, shipping `ENCRYPTION_SECRET` beside the dump it decrypts
-   `POST /api/v2/schema` required no authentication and drops every table
-   `PUT /api/v2/settings` accepted `forms_yaml`, bypassing the lock, validation and restore point
-   `/admin/schedules` and `/admin/stored-jobs` were reachable with only `showSettings`
-   A form's `constants` came from the request instead of the configuration, so a caller could rescope a query

## [6.2.1] - 2026-07-07

### Changed

-   Upgraded git actions to v5
-   Enhanced table views
-   Database connection pooling for better performance

### Added

-   Translations (en, de, fr, es, it, nl)
-   new environment var DEFAULT_LANGUAGE (if no client cookie preference is passed)
-   New `wizard:` property on forms: render a sequence of reusable subforms as numbered steps with Back/Next navigation, per-step validation, optional `defaultModel` prefix to namespace each step's output, optional steps with `when:` visibility expressions, and a `summary` step that shows a read-only review of the merged extravars before submit. Cross-step references work via `$(__parent__.<stepname>.<field>)`.
-   Full editor repository integration (#414) - tx to blaipr
-   Custom logo uploader in the admin panel (#457) - tx to blaipr

### Security

-   Fix authentication bypass via hard-coded default JWT signing secret (GHSA-g27f-cjvv-42rf) - tx to blaipr
-   Fix OS command injection in repository git operations (GHSA-56pr-p4x6-mwm6) - tx to blaipr
-   Fix stored cross-site scripting in job output and form fields (GHSA-wcmj-wqvw-6c88) - tx to blaipr

### Fixed

-   Subforms in the designer (#449)
-   a bunch of minor security fixes (injection, try/catch, etc...)
-   evalDefault in subform (#451)
-   mask pw in yaml field (#450)
-   show output for AWX workflow (#420) (huge thanks to blaipr for the fix)
-   run AF under a sub path (#106) (huge thanks to blaipr for the fix)
-   Guard forms-repo write lock against status wedge on transient race (#459) - tx to blaipr
-   Use localhost and env var for Vite dev proxy target (#465) - tx to blaipr
-   Remove dead server build scripts and unused deps (`npm-run-all`, `rimraf`) (#466) - tx to blaipr
-   Make .mjs tests vitest-compatible and fix AWX abort test failures (#467) - tx to blaipr
-   Fix password field validation checking wrong dirty state on login page (#468) - tx to blaipr
-   Redirect to home when router guards deny access instead of blank page (#469) - tx to blaipr
-   Remove unused `jsonwebtoken` from client dependencies (#470) - tx to blaipr
-   Add `unhandledRejection` handler and log uncaught errors via winston (#471) - tx to blaipr

## [6.2.0] - 2026-05-26

### Added

-   New `list` field type: a multi-row collection field where each row is edited via a subform drilldown. Supports nested lists, shared subforms, marker tracking (`insertMarker`, `deleteMarker`, `updateMarker`), column selection, soft-delete with undo, and full output modelling (`noOutput`, `outputObject`, `model`). Replaces the deprecated `table` field. (#379)
-   New `subform` property on `yaml` fields: when set, the field value is edited via a subform drilldown instead of a raw YAML editor, enabling structured single-object editing with full validation.
-   New `subform` form type: define reusable subforms (referenced by `list` and `yaml` fields) in the same forms file.
-   oauth2 swagger
-   build codes as part of the version

### Fixed

-   Dependency bug, field reset not populated to dependent placeholders
-   oauth2 init after create

### Deprecated

-   `table` field type is deprecated since 6.2.0. Existing `table` fields continue to work but show a deprecation warning. Migrate to the `list` field type combined with a `subform`.
-   `tableFields` / `Tablefield` property is deprecated since 6.2.0. Use the `subform` form type with regular `formfields` instead.
-   `disableRelaunch: true` (form property) is deprecated. Use `allowRelaunch: false` instead — positive naming, same effect.
-   `noOutput: true` (field property) is deprecated. Use `output: false` instead — positive naming, same effect.
-   `enableLogin` (role option) is deprecated. Use `allowLogin` instead — consistent with all other `allow*` role options.

## [6.1.5] - 2026-04-23

### Added

-   added role-option allowVerboseMode (#430)
-   added new role-options for jobscheduling and jobstoring (#431)
-   added new actions (schedule job, run later, store, load from store) (#431)
-   all api's have v2 implementations now
-   New YAML field type: A dedicated YAML editor field with syntax highlighting, validation, and file operations
-   Table field enhancements: Added file import/export capabilities

### Changed

-   role options are all defaulted now explicitly
-   api v1 and v2 split up for v1 deprecation
-   fixed a few security issues (block password retrieval over api)

### Deprecated

-   Data Sources and Data Schemas features - These features are currently only disabled in the GUI and will be completely removed in a future version. If you are actively using these features, please contact the maintainer as soon as possible.  The reason is the implementation of an ORM to switch to postgress in the future.
-   api v1 was not using the best rest implementation (let's say I was a rookie back then).

### Fixed

-   Error logging concatenation in token and job controllers (6 locations)
-   encoding in the expression functions
-   Cronschedules now handled with Croner, which should be better (#436)

## [6.1.4] - 2026-03-30

### Added

-   Error border on expression fields
-   Jq expression on expression with query fields so you can manipulate the otherwise always returning array
-   Added a convertToUtc property for datetime field

### Fixed

-   Ampersand bug (#412)
-   DateTime field input allowed (#416)
-   Approval stuck (#413)
-   multistep status (#413)
-   job relaunch response (#422)
-   see full job info with showAllJobLogs option (#426)

### Changed

-   validIf triggers error
-   new docs using just the docs theme
-   vite 8
-   Host and PID aware aborting, faster, cleaner and would allow multi container setup

## [6.1.3] - 2026-02-23

### Added

-   Option to track a live logfile during playbook execution.  See docs FAQ.  Perfect for long lasting custom actions (custom module) where you can write to a logfile and track live.

### Fixed

-   AzureAD redirect

## [6.1.2] - 2026-02-18

### Added

-   New ldap packages and new ldap tester (ldap uses api/v2 now)

### Changed

-   Vue sonner in favor of vue toastification
-   Cleanup and bumps in vue
-   Drop vuescroller
-   Colors (it's personal maybe)

### Fixed

-   Double checkbox dependency bug

### Breaking

-   Dropped bulma class backward compability for the tiles (use bg-danger, bg-success-subtle, ... from bootstrap)

## [6.1.1] - 2026-02-17

### fixed

-   Credential caching when testing
-   Sequential multistep

### Added

-   More Tile icon styling (size, color, overlayicon, overlaytext)
-   Paramiko in base image

## [6.1.0] - 2026-01-24

### Added

-   Job relaunch feature: Relaunch jobs with pre-filled form data from previous submissions : [issue 311](https://github.com/ansibleguy76/ansibleforms/issues/311)
-   New role option `allowJobRelaunch` to control which users can relaunch jobs
-   New form option `disableRelaunch` to prevent relaunching specific forms
-   Form name validation prevents loading data from mismatched forms
-   Proper permission checks with detailed error messages
-   fnParseHtmlWithRegex now supports basic authentication via credential parameter with UTF-8 encoding support for special characters
-   fnLs, added metadata option to return more file metadata (size, created, etc...)
-   varsFiles form property: Load YAML files as constants merged with base config constants.  Supports both absolute and relative file paths. New `VARS_FILES_PATH` environment variable.
-   minValue, maxValue, minLength, maxLength, minSize and maxSize now support placeholders for dynamic validation.
-   Validation descriptions (regex, validIf, validIfNot, notIn, in) now support placeholders for dynamic error messages.
-   Field labels, help text, and placeholders now support placeholders for dynamic content (e.g., `$(fieldname)`).
-   Notification system enhancements: [issue 332](https://github.com/ansibleguy76/ansibleforms/issues/332).  New `onEvent` property for job lifecycle event notifications (any, launch, relaunch, delete, approve, reject)  Separate `jobevent.html` email template for event notifications (distinct from status notifications)
-   Configuration file migration from forms.yaml to config.yaml.  Introduction of new ENV VARS. `CONFIG_PATH`, `FORMS_FOLDER_PATH` 
-   Automated nightly backup system: New `NIGHTLY_BACKUP_RETENTION` environment variable
-   Multi-repository support for forms, add repo switches "use for config", 'use for varsfiles', 'use for forms', 'use for playbooks'.

### Changed

-   Refactored Job.launch, Job.continue, and Multistep.launch to use object parameters for better maintainability and flexibility
-   Notification system refactored.  Replaced individual event properties (onLaunch, onRelaunch, onDelete, onApprove, onReject) with unified `onEvent` array.  Cleaner separation: `onStatus` for job outcomes, `onEvent` for job lifecycle triggers
-   Configuration architecture modernized.  `forms.yaml` deprecated in favor of `config.yaml` (categories/roles/constants only).  Forms folder path now configurable via `FORMS_FOLDER_PATH` environment variable
-   removed label for html type.  If you want to have some sort of label, excplicitely set a label

### Deprecated

-   `forms.yaml` - use `config.yaml` for configuration (categories, roles, constants)
-   `FORMS_PATH` environment variable - still supported but will be removed in future versions
-   Storing forms in the base config file - forms should be in the forms/ folder

### Breaking

-   to allow user to relaunch, give them the role option `allowJobRelaunch`
-   Deprecated `on` notification property completely removed (use `onStatus` instead)
-   Notification event properties consolidated: use `onEvent: [launch, relaunch, delete, approve, reject]` instead of separate `onLaunch`, `onRelaunch`, etc. properties

### Fixed

-   approval message placeholder
-   small visual job issue
-   OIDC login (kudos to theymademedothat)
-   Password decrypt issue with mail settings
-   fixed credential cache issue

## [6.0.2] - 2025-11-30

### Added

-   MASK_EXTRAVARS_REGEX, to allow extravars masking
-   fnToTable local function, converts array to html table for html info field
-   GIT_CLONE_COMMAND and GIT_PULL_COMMAND env vars added
-   fnLs dir,{recursive,regex}
-   fnParseHtmlWithRegex url,regex,regexflags

### Fixed

-   Several tablefield issues
-   Datetime field didn't bubble changes
-   knownhosts errored on non existing file
-   Recursive checkdependencies
-   check schema for correct dependencies
-   dropdown/enum, working alignment
-   dropdown/enum, refresh and preview
-   readonly and disable props
-   tablefield readonlycolumns (issue 377)
-   on-event-actions fixed
-   fixed abondon jobs loop
-   fnSsh had a bug
-   schedules extravars

### Changed

-   Schema creation in 1 shot
-   lock api to v2
-   knownhosts api to v2

## [6.0.1] - 2025-10-28

### Fixed

-   not, notIn, validIf, validIfNot, all had bugs

### Changed

-   Docker image is moving to debian based.  It's bigger, but alpine was giving dns query issues.

### Added

-   playbooksSubfolder, a subfolder path to launch ansible-playbook from

## [6.0.0] - 2025-10-02

### Fixed

-   multi default in enum field broken
-   verbose was not working well
-   textarea field in table field
-   placeholder (issue 320)
-   scrollbar (issue 318)
-   EntraId groups (issue 316)
-   Add icon not allowed to radio
-   Fixed encryption key length check

## Added

-   updateMarker to table field
-   multi awx (314)
-   backup/restore api (/api/v2/database (get, post/backup, post/restore?folder=))
-   new role option allowDatabaseOps
-   oauth2 table replaces individual azuread, oidc tables
-   integrated backup

### Changed

-   Backend rewritten to ESM (export default / import) -> no more "require" and no more "babel" and no more compiled code
-   Parsing of forms rewritten with individual form validation, should be more stable and faster
-   Backend bumped to Node.js 20
-   Most packages are updated to latest versions
-   Frontend rewritten to work with Vite (still vue2 for now) -> no more "webpack"
-   New sass-dart and bumped bulma framework to 1.0.4
-   Password decryption had a bug in v6beta

### Breaking Changes

-   Since "require" can not be used anymore, the backend code is now ESM only.
    This means that you can not use "require" anymore, but you can use "import" and "export default".  Than means that custom functions must be rewritten to use the new ESM syntax. (/functions/custom.js is an example where this could break)
-   Maybe not breaking, but the old theme is broken for bulma v1, so it might look a bit different here and there. (but note that v6 will have bootstrap)
-   Since many packages are updated, I might have missed some breaking changes like OIDC, packages have been bumped and I don't have an OIDC to test against... any help is appreciated.

## [5.0.10] - 2025-06-05

### Added

-   LOG_TZ env var for timezone (both for logging and returning job logs)  Client convertion is disabled, so the client will always show the time in the timezone of the server.
-   Added new role option `enableLogin` to allow login for this role.  If not set, login is enabled.  Set to false on the public role to disable login overall, and set to true of the roles that should allow login.
-   fn.fnRestAdvanced allows 3 placeholderfunctions (base64, username and password)
-   fn.fnRestAdvanced allows a new "raw" parameter to return the data + the response_headers

### Fixed

-   Enum with multiple and objects were not always selecting correct defaults
-   5.0.9 had awx issues.

### Breaking Changes

-   Removed old deprecated type "query" (is enum now)

## [5.0.9] - 2025-06-04

### Fixed

-   Reduce formConfig by roles // <https://github.com/ansibleguy76/ansibleforms/issues/262>
-   User-based roles fix // <https://github.com/ansibleguy76/ansibleforms/issues/264>
-   Ldap DN with comma's, are now properly escaped // bump ldap-authentication - ldapjs => ldapts

### Added

-   Added 2 env vars VUE_APP_NAV_HOME_LABEL and VUE_APP_NAV_HOME_ICON and a forms nav link 
-   Datasources and schema see documentation for more info
-   Schedules, allow scheduled forms
-   hvac pip lib for hashi vault integration
-   awxApiPrefix, default to /api/v2, for future AAP changes (<https://github.com/ansibleguy76/ansibleforms/issues/279>)
-   Added 2 table field properties tableTitleAdd, tableTitleEdit (<https://github.com/ansibleguy76/ansibleforms/issues/277>)
-   Added option showAllJobLogs (<https://github.com/ansibleguy76/ansibleforms/issues/273>)
-   Added option to relaunch verbose (<https://github.com/ansibleguy76/ansibleforms/issues/280>)

## [5.0.8] - 2025-02-13

### Fixed

-   Regex in repo's
-   Jwt token issuer added (use env variable ACCESS_TOKEN_ISSUER) - credits to le-martre for the fix
-   maxBuffer causing abort by operator, adding PROCESS_MAX_BUFFER variable. // <https://github.com/ansibleguy76/ansibleforms/issues/247>

### Changed

-   The admin user can now be removed, and will be recreated automatically if needed at first start.
    use env variables ADMIN_USERNAME and ADMIN_PASSWORD.

### Added

-   YTT extra environment variable (see help)
-   Role options (showDesigner, showLogs, showSettings, ...) allowing for custom semi-admin or designer roles
-   Added branch to repos

## [5.0.7] - 2024-10-03

### Added

-   Added scm branch option to pass to awx

### Fixed

-   AzureAD with more than 100 groups was not working anymore since introduction of OIDC
-   Mysql check during init failed and skipped part of init
-   App now properly waits for mysql to be ready before starting
-   Vuelidate 2+ was not working properly for dependent required fields

## [5.0.6] - 2024-09-20

### Fixed

-   Removed ip lib parts CVE related
-   Updated to vuelidate 2+ (CVE related)

### Added

-   New dockerfile with debian

## [5.0.5] - 2024-09-18

### Fixed

-   Fixed regex for ssh key
-   New version highlight for CVE
-   Bumped several versions

## [5.0.4] - 2024-08-18

### Added

-   If forms.yaml is missing, it will be auto created. This is useful for new installations without docker-compose
-   Same for certificates

### Changed

-   Async await replacements for promises (readability)

### Fixed

-   Some credentials bugfixes

## [5.0.3] - 2024-06-21

### Added

-   Option to disable/enable schema creation (ALLOW_SCHEMA_CREATION)
-   Forms yaml can now be in the database (overriding the local file)
-   Database queries are by default no longer logged, use ENABLE_DB_QUERY_LOGGING to enable it again
-   Mongodb connection test

### Changed

-   Improved schema creation error messages and error handling
-   Schema patching is now done at application initialization
-   Rewrote database connections with await/async

### Fixed

-   Vault credentials, alpine requires decode -d instead --decode
-   Type on jobstatus notification template

## [5.0.2] - 2024-06-10

### Adding

-   Now allowing string (credential name) or array (of names) as dbConfig (dbtype is fetched from the database, with mysql fallback)
    When using array, the resultsets are merged.
-   Added ytt implementation to template yaml files (credits mdaugs)
-   Vault credentials, pass a vault password to ansible playbook.
-   OIDC authentication (credits mdaugs)
-   Ansibleforms will now wait for mysql to be ready before initializing

### Changed

-   job api return objects (extravars, notifications, credentials, ...) instead of json strings
-   awx job id is added to the database

### Fixed

-   radio button errors
-   some issue with the designer when a field without name was added
-   multistep was always successfull (tx to mdaugs)
-   using cookie session instead express session

## [5.0.1] - 2024-04-10

### Fixed

-   login expiryDays didn't work
-   fixed non-ascii codes in ldap
-   fixed approvals, broken since 4.0.19

### Added

-   add a form-reload route
-   added mail attribute ldap
-   improved error message on unevaluated fields
-   allow to model arrays like foo.bar[0].ping.pong[1]
-   allow placeholders in description fields of field validation

## [5.0.0] - 2024-01-25

### Added

-   in remote expression functions, we throw errors so they show up in the form.
-   added valueColumn "\*" and placeholderColumn "\*", to return all column, this also means that valueColumn "\*" results in the same as outputObject: true. 
-   jobid is passed now as extravar and passed to nextform, incase an action exists
-   you can now hide a text field
-   more advanced ldap properties for non active directory ldap servers
-   git repositories generic (for forms and playbook for example)
-   added expiryDays to login api, for longlived tokens (admin only)
-   added jwt tokenPrefix property on jwt functions
-   allow admin role fallback for local/admins group in case no forms are found
-   radio button values property can now have array of objects (label, value)
-   instanceGroups property on forms => choose awx instanceGroups
-   enable verbose checkbox for quick ansible verbose mode

### Removed

-   git repo type, you can no longer target git repo's from a form, this is breaking when you upgrade to 5.0.0 and use the formtype 'git'

### Fixed

-   awx workflow template failed with 404
-   ldap usernameattribute not used
-   fixed database query issue for postgres
-   use ldap-authentication main code (no npm)
-   try ldap group objectName first

## [4.0.19] - 2023-11-22

### Fixed

-   undefined error with json

### Added

-   Added AzureAD group filter to limit the number of groups

## [4.0.18] - 2023-11-10

### Fixed

-   javascript replace error with defaults
-   Newer Netapp collection 22.8.2

## [4.0.17] - 2023-11-07

### Fixed

-   AzureAD only returned first 100 groups.
-   Constants with arrays now work correctly
-   Little ldap test bug
-   model bug, bad merging and weird caching

### Added

-   Expression field can now have property `value` for manual data assignment
-   Added form property ansibleCredentials, allowing to pass ansible_user and ansible_password

## [4.0.16] - 2023-10-07

### Changed

-   Ansible has now default yaml stdout
-   fn.fnCredentials can have regex and a second ballback

### Added

-   New formfield type 'file' to upload files prior to job execution
-   New Database property in credentials, needed for postgres, and can be used for mysql and mssql
-   credentials property on forms => array of credentials to add
-   awxCredentials property on forms => array of awxCredentials to add
-   executionEnvironment property on forms => choose awx executionEnvironment

### Fixed

-   Int64 issues in rest results, new rest parameter 'hasBigInt'
-   Issue with null values in enum fields

## [4.0.15] - 2023-08-09

### Added

-   Installation video to documentation
-   add fnGetNumberedName as local function

### Fixed

-   Table expression issue fixed

## [4.0.14] - 2023-08-03

### Added

-   New documentation, the website ansibleforms is now generated on github pages using jekyll

### Changed

-   Removed environment variable from reference guide (find it in documentation now)

### Fixed

-   Scheme creation bug fixed
-   Typos in help
-   Vue2 bug number fields fall back to emptry string when empty.  fixed to set to undefined.

## [4.0.13] - 2023-07-24

### Added

-   New dependency mechanism isValid
    you can show/hide a field based if another field is valid or not

## [4.0.12] - 2023-07-15

### Changed

-   Modals are now 1024px

### Added

-   Allow enum array-of-objects values.
-   New alias local_out (=> hidden local expression)
-   New alias credential (=> hidden local expression with asCredential true)

## [4.0.11] - 2023-06-08

### Added

-   Allow users in roles

### Fixed

-   app crash on bad rest body
-   errors were not shown in output

## [4.0.10] - 2023-05-23

### Fixed

-   help added
-   fixed sql init
-   set a few columns to utf8mb4 for emoticon issues
-   add interval to cleanup 1 day old running jobs
-   better database check error handling, if the database is offline, no create schema button will be shown

### Added

-   Added alias type 'local' => expression, runLocal, hide, noOutput

## [4.0.9] - 2023-05-07

### Added

-   model can now be an array
-   html field

### Fixed

-   form could be executed while non-required fields were being evaluated

### Changed

-   expression field can have newlines, they will be removed.

## [4.0.8] - 2023-05-03

### Added

-   new function fn.fnCidr // core implementation of ip.subnet() <https://www.npmjs.com/package/ip>
-   new function fn.fnTime // core implementation of dayjs() <https://day.js.org>
-   background image on login screen (that you can overwrite)

## [4.0.7] - 2023-05-01

### Fixed

-   Default dependency bug
-   nested placeholder expressions
-   removed google font uri to local
-   awx retry jobs

### Added

-   Added clean up abandoned jobs at startup

## [4.0.5] - 2023-04-15

### Added

-   Allow awx connection with username and password
-   Added about me for
-   Added new env var with regex to filter job output

### Changed

-   Friendlier schema error messages

### Fixed

-   Non admin can see their own approve jobs
-   Wrong stdout with AWX sometimes

## [4.0.3] - 2023-03-06

### Fixed

-   Add select-all box with single column multiselect enum
-   Required not enforced on multiple enum
-   Log view since date-based logfiles
-   enum dropup correct calculation
-   issues with multistep and key
-   add user profile in steps

### Added

-   Add enum horizontal mode
-   Add azure ad oAuth2 login method
-   Add server fn.fnSsh function
-   Showing env.variables in the settings
-   Showing known_hosts and allow removal
-   Added limit property for ansible playbooks

### Changed

-   Moved form backups to subfolder (new ENV VAR)
-   Made backup age configurable (new ENV VAR)
-   New theme look
-   New settings menu
-   Improved joblog navigation, using url params

## [4.0.2] - 2023-02-10

### Added

-   Userobject is available in form with **user** => $(**user**)
-   New field type datetime (date and time picker)

### Changed

-   An object-expression is now possible => "{foo:'bar'}"
-   Bumped corejs and axios

### Fixed

-   Colons failed in password due to bad passport-http
-   Number field was exported as string

## [4.0.1] - 2023-01-27

### Fixed

-   Saving settings error
-   Table field issues

### Added

-   Ansible Galaxy collection community.general
-   TextArea field

### Changed

-   Designer readonly when locked

## [4.0.0] - 2022-12-31

### Fixed

-   Dependencies are now AND not OR
-   Using mysql2 lib to fix authentication issues
-   Fixed AWX Task issue when failed
-   Auto select current form in designer
-   Placeholder with dash bug
-   UTF8 character in extravars breaks local ansible execution

### Added

-   Added dynamic playbook and template name $(extravar)
-   Designer Locking (env var)
-   Pass external data to form
-   Reference Guide
-   Add verbose logging for ansible (verbose: true)
-   Add keepExtravars property to keep the tmp extravars json file

### Changed

-   Better error messages with remote expressions
-   Running extravars from tmp file (due to utf8 issues)
-   Rolling log file

### Deprecated

-   formfield type query is deprecated, use 'enum'

## [3.1.1] - 2022-11-10

### Fixed

-   Ldap certificate bug
-   Drop quotes on string placeholder
-   Expressions were forced to required field
-   Dropping mssql package to v8 hoping to fix hang up issue
-   Dependency bug fixed with multiple dependencies
-   Preview bug fixed when column was empty

### Added

-   Local selectAttr function
-   Local regexBy function
-   Add wildcard support on filterBy function
-   PostActionsEvents
    -   events: onSubmit, onSuccess, onFailure, onFinish
    -   actions with delay: load (a form), reload (same form), home, clear (reset form), hide/show (form)
-   ifExtraVar property on step for conditional step

## [3.1.0] - 2022-10-28

### Added

-   Search functionality forms
-   Full with html
-   Allow "notIn" and "in" validation in tablefields
-   Add nested categories

## [3.0.9] - 2022-10-21

### Fixed

-   Allow password type in tablefield
-   Fixed sql connection problems
-   Fixed filterColumns bug

### Added

-   Added fnArray runLocal functions (filterBy,distinctBy,sortBy)

## [3.0.7] - 2022-09-26

### Added

-   Allow secure connection for mysql

### Changed

-   Updated nodejs packages

## [3.0.6] - 2022-08-10

### Fixed

-   Fixed multiselect bug

## [3.0.5] - 2022-07-06

### Added

-   Add object-like default value for dropdowns
-   Add email notifications
-   Allow custom git user/email per repo

### Fixed

-   Allow selfsigned certificates in mailserver
-   Auto qdd repo hosts to known_hosts + add gui for manually

## [3.0.4] - 2022-06-09

### Fixed

-   Forgot fs-extra in package

### Added

-   Added 'ansibleforms_user' as object to extravars

## [3.0.3] - 2022-06-02

### Changed

-   Improved gui management (table format with paging and filtering)
-   Updated all packages and no-cache build

### Fixed

-   You cannot remove a group with users

## [3.0.2] - 2022-04-25

### Added

-   More form validations
-   Show expression and query form warnings
-   Allow for expression references to have full object placeholder .e.g. $(settings.servers[0].name)

### Changed

-   Rewrote all callbacks to promises
-   Query filter in dropdown

### Fixed

-   Remove query filter on values change
-   Reset query value when "no data"

## [3.0.1] - 2022-04-01

### Added

-   Syslog integration (use env variables to tune)
-   Relaunch and abort from joblog
-   Override repo clone command
-   Add log filtering and auto refresh
-   Approvals and rejections (using new approval property)

### Changed

-   Logger levels changed (error, warning, notice, info, debug) / debug is lowest (silly is deprecated)
-   Completely reworked job launch process (neater code and more reusable)
-   Swagger job launch is now at job level

### Fixed

-   Allow non rsa ssh key
-   Add job access to own jobs in joblog
-   Repo runs silent

### Removed

-   Ansible launch api (see job post now)
-   Awx launch api (see job post now)
-   Multistep launch api (see job post now)

## [3.0.0] - 2022-03-09

### Added

-   About + GPL License
-   Added new type : push to git
-   Added property `key` : allow extravars to be specific key
-   Added extravars to joblog
-   Added awx to joblog
-   Added new type : multistep
-   Added LogViewer
-   Added SSH key autogen + update
-   Added Git repo gui

### Fixed

-   Allow local expressions for query
-   Wrong timezone timestamp in joblog
-   Referencing (placeholder) multi select will now return array

### Removed

-   Awx and ansible get job api => is now native job api
-   Awx and ansible joboutput => is now native job output
-   Ansible and awx job aboort => is now native job abort

## [2.2.4] - 2022-02-15

### Added

-   Allow field named \_\_inventory\_\_ to have array to launch against multiple inventories (ansible only)
-   Add new validation `validIf` and `validIfNot`.  Use an expression field as validation.
-   Add new `refresh` property to manually or auto refresh expression/query fields.
-   Add table enhancements
    -   prepopulate with `query` and `expression`
    -   insertMarker and deleteMarker (to mark deleted or new records)
    -   allowDelete and allowInsert (to allow insert/delete)
    -   readonlyField
            With this table feature you can now load existing data and use table to modify it.  
            The allowInsert set to false will focus on modification only.  
            The deleteMarker set to value of choice, will allow you to use ansible `absent` for deleted records.  
            Read the wiki for more details.

### Fixed

-   Fixed a bug in notIn and in validation
-   Fixed (dependency + expression) bug
-   Fixed execute bug (read proper exit code)
-   Fixed Warning color to orange
-   Removed constants from new form in designer

### Changed

-   Upgrade from fontawesome 5 to 6
-   Label is no longer a required property

## [2.2.3] - 2022-02-11

### Added

-   function fnCredentials(name) to get credentials
-   function fnRestJwtSecure to pass a credential name, the password of the credentials is assumed the token
-   Add noLog property to field for expression and query fields, no expressions, queries and results will be logged.
-   Add new theme

### fixed

-   A clipping visualization improvement

## [2.2.2] - 2022-02-09

### Fixed

-   Dropdown box gets clipped at the bottom (was new bug since 2.2.1)
-   Dependencies either with valueColumn or dot-notation

## [2.2.1] - 2022-02-07

### Added

-   Toggle hidden fields for admins
-   Allow expression debug for admins

### Fixed

-   Ignore error if no forms subdir exists
-   Allow empty constants in designer (must be object bug)

## [2.2.0] - 2022-02-03

### Added

-   Keydown responsiveness on text fields (property `keydown`)
-   filtering to query fields (tune with `filterColumns` property)
-   view of objects and query results
-   queryfield-option in table field (`type: query` + `from`-property)
-   search-replace-box in editor (`ctrl-f` or `ctrl-h`)
-   Forms.yaml can be extended with more yaml files in `/forms` subdir.
-   auto backup on save (from editor)
-   restore backup (from editor)
-   Editor can now edit a single form
-   Added warnings in editor and form
-   Expression can be html (`isHtml` property)
-   Added constants section in forms.yaml (key-value pairs in yaml format)

### Fixed

-   Bad required validation when expression had default empty object or array
-   Interval kept running in the background

## [2.1.6] - 2022-01-25

### Added

-   Expressions can have defaults
-   Extra form checking and show warnings

### Changed

-   Secured JWT tokens even more

### Fixed

-   Fixed editable expression bug
-   Token issue

## [2.1.5] - 2022-01-20

### Added

-   Start with changelog
-   Start with version releases

## [2.1.4] - 2022-01-20

### Added

-   Start with changelog

### Changed

-   Hide AWX token
-   Add AWX ca-bundle for certificate verification
-   JWT tokens, allow multiple devices
-   Expression field can be `editable`

## [2.1.2] - 2022-01-17

### Added

-   Allow rest api search by name for credentials, users and groups

## [2.1.0] - 2022-01-16

### Added

-   Expression can now do a db query using `dbConfig` and `query`

### Changed

-   Fixed visualization bug

## [2.0.0] - 2022-01-13

### Added

-   Added sticky feature to Query field
-   Added pctColumns to Query field
-   Added now sorting description object on fnRestBasic
-   Added now sorting description object on fnReadJson
-   Added now sorting description object on fnReadYaml
-   Added fnRestJwt, rest with token
-   Added fnRestAdvanced, rest with custom headers
-   Added fnJq function, to do json queries
-   Added default definitions for jq (fnRound,fnRound0,fnRound1,fnRound2, fn2KB, fn2MB, fn2GB)
-   Added jq.custom.definitions to allow custom jq definitions
-   Added notIn and in validation

### Removed

-   Sort & Map on fnRestBasic is removed
-   Sort & Map on fnReadYaml is removed
-   Sort & Map on fnReadJson is removed

## [1.2.2] - 2022-01-12

### Added

-   Add custom.js to allow custom expression
-   Start keeping releases in docker-hub

## [1.2.1] - 2022-01-12

### Fixed

-   Ignore AWX certificate errors

## [1.1.9] - 2022-01-11

### Added

-   Allow check and diff in ansible and awx

## [1.1.8] - 2022-01-11

### Added

-   Allow change password for current local user
-   Start tracking versions

[Unreleased]: https://github.com/ansibleguy76/ansibleforms/compare/6.1.5...HEAD

[6.1.5]: https://github.com/ansibleguy76/ansibleforms/compare/6.1.4...6.1.5

[6.1.4]: https://github.com/ansibleguy76/ansibleforms/compare/6.1.3...6.1.4

[6.1.3]: https://github.com/ansibleguy76/ansibleforms/compare/6.1.2...6.1.3

[6.1.2]: https://github.com/ansibleguy76/ansibleforms/compare/6.1.1...6.1.2

[6.1.1]: https://github.com/ansibleguy76/ansibleforms/compare/6.1.0...6.1.1

[6.1.0]: https://github.com/ansibleguy76/ansibleforms/compare/6.0.2...6.1.0

[6.0.2]: https://github.com/ansibleguy76/ansibleforms/compare/6.0.1...6.0.2

[6.0.1]: https://github.com/ansibleguy76/ansibleforms/compare/6.0.0...6.0.1

[6.0.0]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.10...6.0.0

[5.0.10]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.9...5.0.10

[5.0.9]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.8...5.0.9

[5.0.8]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.7...5.0.8

[5.0.7]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.6...5.0.7

[5.0.6]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.5...5.0.6

[5.0.5]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.4...5.0.5

[5.0.4]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.3...5.0.4

[5.0.3]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.2...5.0.3

[5.0.2]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.1...5.0.2

[5.0.1]: https://github.com/ansibleguy76/ansibleforms/compare/5.0.0...5.0.1

[5.0.0]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.19...5.0.0

[4.0.19]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.18...4.0.19

[4.0.18]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.17...4.0.18

[4.0.17]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.16...4.0.17

[4.0.16]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.15...4.0.16

[4.0.15]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.14...4.0.15

[4.0.14]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.13...4.0.14

[4.0.13]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.12...4.0.13

[4.0.12]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.11...4.0.12

[4.0.11]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.10...4.0.11

[4.0.10]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.9...4.0.10

[4.0.9]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.8...4.0.9

[4.0.8]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.7...4.0.8

[4.0.7]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.5...4.0.7

[4.0.5]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.3...4.0.5

[4.0.3]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.2...4.0.3

[4.0.2]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.1...4.0.2

[4.0.1]: https://github.com/ansibleguy76/ansibleforms/compare/4.0.0...4.0.1

[4.0.0]: https://github.com/ansibleguy76/ansibleforms/compare/3.1.1...4.0.0

[3.1.1]: https://github.com/ansibleguy76/ansibleforms/compare/3.1.0...3.1.1

[3.1.0]: https://github.com/ansibleguy76/ansibleforms/compare/3.0.9...3.1.0

[3.0.9]: https://github.com/ansibleguy76/ansibleforms/compare/3.0.7...3.0.9

[3.0.7]: https://github.com/ansibleguy76/ansibleforms/compare/3.0.6...3.0.7

[3.0.6]: https://github.com/ansibleguy76/ansibleforms/compare/3.0.5...3.0.6

[3.0.5]: https://github.com/ansibleguy76/ansibleforms/compare/3.0.4...3.0.5

[3.0.4]: https://github.com/ansibleguy76/ansibleforms/compare/3.0.3...3.0.4

[3.0.3]: https://github.com/ansibleguy76/ansibleforms/compare/3.0.2...3.0.3

[3.0.2]: https://github.com/ansibleguy76/ansibleforms/compare/3.0.1...3.0.2

[3.0.1]: https://github.com/ansibleguy76/ansibleforms/compare/3.0.0...3.0.1

[3.0.0]: https://github.com/ansibleguy76/ansibleforms/compare/2.2.4...3.0.0

[2.2.4]: https://github.com/ansibleguy76/ansibleforms/compare/2.2.3...2.2.4

[2.2.3]: https://github.com/ansibleguy76/ansibleforms/compare/2.2.2...2.2.3

[2.2.2]: https://github.com/ansibleguy76/ansibleforms/compare/2.2.1...2.2.2

[2.2.1]: https://github.com/ansibleguy76/ansibleforms/compare/2.2.0...2.2.1

[2.2.0]: https://github.com/ansibleguy76/ansibleforms/compare/2.1.6...2.2.0

[2.1.6]: https://github.com/ansibleguy76/ansibleforms/compare/2.1.5...2.1.6

[2.1.5]: https://github.com/ansibleguy76/ansibleforms/compare/2.1.4...2.1.5
