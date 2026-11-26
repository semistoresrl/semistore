# Aggiornamento da Danea

1. Copia l'archivio Danea (`.eft`, o il backup `.bef`) qui nel contenitore.
2. Lancia `python3 tools/danea/aggiorna.py "<archivio>" aggiornamento_danea_AAAA-MM-GG.json.gz`. Servono Firebird 2.5 embedded e il modulo `fdb`; la libreria si indica con `FB_LIB`.
3. Nell'app, come amministratore: Impostazioni → **Aggiorna da Danea (tutto)** → scegli il file → Aggiorna.

Cosa fa: aggiorna le numerazioni (le schede continuano dal numero Danea dell'anno, i preventivi dal numero dei preventivi Danea), crea le schede aperte (rapporti d'intervento degli ultimi 90 giorni non ancora richiamati in DDT, fattura o banco) con lo stesso numero di Danea, segna consegnate le schede importate che in Danea sono state chiuse, e aggiorna clienti, storico riparazioni, Archivio Danea e Storico codice.
Si può rifare quante volte serve: non crea doppioni.
**Non tocca le giacenze**: niente carichi né scarichi. I ricambi delle schede importate sono segnati `daDanea` e non muovono il magazzino nemmeno se la scheda viene modificata o eliminata.
Nel file non ci sono dati del repository: il pacchetto contiene dati dei clienti, non va mai messo nel repository.
