# Phone notifications for visits, reports and enquiries — what is yours to decide

Written 15 October 2026. It answers items 6 and 7 of the practice's list of
6 October: tell a household on its phone when a visit is booked, moved or
called off and when a report is ready, and tell the office when a website
enquiry arrives. It is built on the phone notifications that are already
live (round 75): the same key pair, the same sealing, the same three push
services on the vendor register. Nothing new receives anybody's information.

**Nothing is sent until the practice's key pair is set.** Production has no
key pair today, so production sends nothing. That is unchanged: with no key
pair the households see no "turn on" step, the console shows no switch, and
nothing is attempted.

Every choice below was made with a default so the work could be finished.
Each one says what was chosen and why, and the one line to reply with if you
want it otherwise. "As built" is a complete answer to all of them.

## The words, for your approval

Every message is short enough for a lock screen and says nothing sensitive:
no name, no address, no practitioner, no service, never what kind of report,
never who sent an enquiry. A visit carries only its day and time, in Dubai
time, written the UAE way (day/month/year, 24-hour clock).

The Arabic needs a native speaker's check before the practice switches
notifications on.

| When | English title | English text | Arabic title | Arabic text |
|---|---|---|---|---|
| A visit is booked | Visit booked | Your visit is booked for 20/10/2026 at 09:30. | تم حجز الزيارة | تم حجز زيارتكم يوم 20/10/2026 الساعة 09:30. |
| A visit moves | Visit moved | Your visit has moved to 20/10/2026 at 09:30. | تم تغيير موعد الزيارة | تم نقل زيارتكم إلى يوم 20/10/2026 الساعة 09:30. |
| The practice calls a visit off | Visit called off | The practice has called off your visit on 20/10/2026 at 09:30. | أُلغيت الزيارة | ألغى المركز زيارتكم يوم 20/10/2026 الساعة 09:30. |
| A report is ready | New report | A new report is ready in your portal. | تقرير جديد | يوجد تقرير جديد جاهز في بوابتكم. |
| A website enquiry arrives (staff only, English only) | New website enquiry | Open Enquiries in the console to read it. | — | — |

Pressing a household's notification opens Visits or Reports in their
portal. Pressing the staff one opens Enquiries in the console.

## The decisions

### 1. "Booked" is sent when the visit is confirmed, not when it is first placed

A visit placed with "Add appointment" starts as *proposed*: a slot the
practice is holding and has not yet put to the household. The portal does not
show proposed visits, on purpose. So the notice goes when the office presses
**Confirm**, which is the moment the visit appears in the household's portal.

Reply "send booked when placed" to change it — but the household would then be
told of a visit their portal does not show.

### 2. "Moved" only for a confirmed visit whose time changes

A proposed visit that moves says nothing (nobody was told the first time).
Changing the practitioner on the same time says nothing; a handover that also
changes the time is told as a move. The day map's
reorder only ever moves proposed visits, so it says nothing either.

### 3. "Called off" only when the practice calls off a confirmed visit

When the reason is "the practice's own change of plan". When the household
called it off, or the visit could not go ahead at the door, they already know
and nothing is sent.

### 4. Who receives a household notice

These are service messages, not marketing, exactly as announcements are:
every adult portal login on that person's record who has turned
notifications on, whether or not they agreed to offers, and with no monthly
limit. Never a young person's own login.

A report is narrower: only the people who may read it in the portal — a legal
guardian, or the person themselves once an adult. A relative on the record who
is not a guardian is told of visits but not of reports.

### 5. Which language

Each person's own language setting (the one their portal opens in), one
language per message. Staff notices are English only, as the console is.

### 6. Who on the staff is told of a new enquiry

Whoever can see Enquiries today: the owner, an admin and the lead
practitioner — and only once each has turned it on for their own browser, in
the console under **Phone notifications** (beside Password, at the bottom of
the menu). A colleague's browser is theirs alone; nobody can see or switch off
anyone else's. Someone who loses the role stops being told at once.

A burst of website enquiries is told once: after a notice, the next one waits
ten minutes, so a busy morning (or somebody misusing the website's form)
cannot fill the office's phones. Every enquiry is still in the list. Reply
"every enquiry" to send one notice each.

### 7. Sent after the act, once, never retried

The notice is sent only after the booking, move, cancellation, report or
enquiry has been saved, so it can never slow or break the act itself. Each
event is notified at most once. If a phone's service does not answer, that
phone misses that notice; nothing tries again in a loop.

### 8. What is kept

Each event notified is recorded by its kind, the id of the visit, report or
enquiry, how many people and phones it went to, and how many took it. Never
the words, never a name. No screen shows this record yet; it is there so the
practice can show what it sent if asked. Reply "show the record" if you want
it listed under Settings › Notifications beside the practice's own messages.

### 9. Brain-map reports from outside (pull request 253)

That work is not merged. The "report ready" notice follows the moment any
report is issued on this branch, brain maps included; if 253 brings reports in
some other way, they will be hooked when it merges.

### 10. A colleague who leaves keeps nothing, but their browser address stays

Someone suspended or archived is never sent anything again. The address of the
browser they turned on is kept in its table until the browser itself goes away
(the push service then says so and it is deleted) or until they turn it off.
Reply "remove on archive" to have it deleted the moment a colleague is
archived.

### 11. A shared computer belongs to whoever turned it on last

If two colleagues turn notifications on in the same browser, it becomes the
second one's. The first is not told; they stop receiving notices on that
browser.

## Before switching on

1. A native Arabic check of the four Arabic messages above, and of the five
   new Arabic lines in the practice's activity trail (the record of who turned
   notifications on or off and of each notice delivered):
   - سُجِّل إشعار بحدث للهواتف
   - سُلِّم إشعار بحدث إلى الهواتف
   - … فعّل الإشعارات على متصفح
   - … أوقف الإشعارات على متصفح
   - خرج متصفح من إشعارات الفريق
2. The practice's key pair set on the host (the step in the 17 September
   memo). Without it, nothing is sent and nothing changes.
