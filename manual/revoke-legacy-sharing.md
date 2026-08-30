# Odebrání historického sdílení Personalspace

Tento jednorázový postup použij u Personalspace, který mohl podle starého
runbooku získat GitHub collaboratora. Od decision 0091 je Personalspace
výhradní intimní prostor jednoho Principála a jeho volitelného Buddyho. Prázdné
`shared_spaces` není důkazem, že na GitHubu nezůstal starý grant.

## 1. Udělej read-only inventář

Pro owner repo, gbrain repo a každý materializovaný osobní modul spusť:

```text
gh api --paginate repos/<owner>/<repo>/collaborators --jq '.[].login'
gh api --paginate repos/<owner>/<repo>/invitations --jq '.[] | [.id, .invitee.login] | @tsv'
```

První výsledek smí obsahovat pouze GitHub login Principála, druhý musí být
prázdný. Starý grant může zůstat jako čekající pozvánka a po pozdějším přijetí
by znovu otevřel přístup. Buddy jedná pod účty a credentials Principála; nemá
vlastní collaborator grant. GitHub Apps a jejich installation scope ověř
odděleně v nastavení osobního GitHub účtu, pokud je Principál někdy instaloval.

## 2. Odeber každý cizí grant

Každého dřívějšího collaboratora odeber explicitně z každého dotčeného repa:

```text
gh api -X DELETE repos/<owner>/<repo>/collaborators/<former-collaborator>
gh api -X DELETE repos/<owner>/<repo>/invitations/<invitation-id>
```

Jde o externí access změnu. Příkaz smí Principál provést až po kontrole přesného
repa a loginu; Task Agent ho nesmí spustit bez jeho explicitního pokynu v
daném tasku.

## 3. Ověř hranici

Po odebrání grantů spusť v rootu Personalspace:

```text
bun run doctor
```

Doctor fail-closed kontroluje skutečné GitHub collaborators i čekající
repository invitations u owner repa, gbrain repa a všech materializovaných
modulových rep. Potom v GitHub UI ověř, že na osobním účtu nezůstala
neočekávaná GitHub App s přístupem k těmto repům. App inventář je
owner-controlled kontrola, ne nový HnM permission systém.
