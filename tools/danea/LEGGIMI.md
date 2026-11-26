# Aggiornamento da Danea

1. Copia l'archivio Danea (`.eft`, o il backup `.bef`) qui nel contenitore.
2. Lancia `python3 tools/danea/aggiorna.py "<archivio>" aggiornamento_danea_AAAA-MM-GG.json.gz`. Servono Firebird 2.5 embedded e il modulo `fdb`; la libreria si indica con `FB_LIB`.
3. Nell'app, come amministratore: Impostazioni → **Aggiorna da Danea (tutto)** → scegli il file → Aggiorna.

Cosa fa: aggiorna le numerazioni (le schede continuano dal numero Danea dell'anno, i preventivi dal numero dei preventivi Danea), crea le schede aperte (rapporti d'intervento degli ultimi 90 giorni non ancora richiamati in DDT, fattura o banco) con lo stesso numero di Danea, segna consegnate le schede importate che in Danea sono state chiuse, e aggiorna clienti, storico riparazioni, Archivio Danea e Storico codice.
Si può rifare quante volte serve: non crea doppioni.

**Uso in parallelo (Danea e app insieme)**: ad ogni aggiornamento i rapporti d'intervento degli ultimi 120 giorni vengono confrontati con le schede fatte nell'app (stesso cliente per codice, nome o telefono; stesso modello; data del rapporto da 3 giorni prima dell'apertura della scheda a 7 giorni dopo la consegna):
- scheda dell'app e rapporto Danea della stessa riparazione → la scheda dell'app viene collegata al rapporto (numero Danea nelle note e sulla scheda), nessuna scheda nuova;
- se il rapporto era già stato importato come scheda a parte e quella scheda non è mai stata toccata nell'app → il doppione viene tolto e resta la scheda dell'app;
- se tutte e due sono state modificate → nessuna viene cancellata: tutte e due prendono la nota "Possibile doppione", da controllare a mano;
- rapporto chiuso in Danea (richiamato in DDT, fattura o banco) → la scheda collegata diventa Consegnata.
Se il numero Danea è già usato da una scheda dell'app, la scheda importata prende il numero con "-D".
**Non tocca le giacenze**: niente carichi né scarichi. I ricambi delle schede importate sono segnati `daDanea` e non muovono il magazzino nemmeno se la scheda viene modificata o eliminata.
Il pacchetto contiene dati dei clienti: non va mai messo nel repository.
