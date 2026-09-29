/**
 * Version 1 of the brain-map report's fixed wording, in English and Arabic.
 *
 * **A draft until a person approves it.** Every sentence here is read by a
 * household, so none of it is the builder's to settle. `WORDING_STATUS` in
 * `index.ts` says `draft` for both languages, the issue route refuses to sign
 * a report in a language that is still a draft, and the pull request that
 * carries the approved text is what turns it over.
 *
 * **Where the words came from.**
 * - The first report's wording is the practice's own, from the report tool it
 *   used before, changed only where a word belonged to another kind of
 *   practice: this one is a wellness practice and the page a household signs
 *   says so (`docs/CONSENT/agreement.en.md`, "What we do"). "Background"
 *   stands where a history of another kind stood, "concerns" where the old
 *   text named what a person suffers, "training" and "programme" where it
 *   named what is given elsewhere.
 * - The follow-up's headings, its opening paragraphs and its lists of choices
 *   are the founder's, from her request of 29 September 2026.
 * - The follow-up's sentences for a band or a kind of connectivity that has
 *   changed, the sentence printed for each next stage, and everything on the
 *   page headed "What Has Changed" were drafted for this version and are hers
 *   to alter.
 * - The Arabic follows the terms of the pages a household has already signed
 *   (`docs/CONSENT/*.ar.md`). The old tool used other terms for the training
 *   and for the brain map; a household should meet in its report the words it
 *   met in its agreement.
 *
 * **What is not here.** The sentences that say what the practice is NOT are
 * quoted, word for word, from the approved agreement by
 * `domain/reports/document/strings.ts` and printed from there. The old
 * report's own closing paragraph of that kind is replaced by them, so a report
 * and an agreement cannot say two different things.
 *
 * **Three habits of this file,** each held by `wording.test.ts`:
 * 1. Arabic is written without vowel marks. The document writer joins letters
 *    but places a mark roughly, and modern Arabic print leaves them out.
 * 2. "About" is a word. The installed typeface has no sign for it, and a sign
 *    it cannot draw is dropped in silence.
 * 3. A clause that joins the end of a sentence begins with its own comma or
 *    space. Nothing here is to be trimmed.
 *
 * `**` opens and closes bold. `{name}` is a gap `fill` fills.
 *
 * Once version 1 is approved this file does not change. A sentence that needs
 * altering is altered in `v2.ts`, and a report already signed goes on printing
 * the words it was signed with.
 */

import type { Entry, Phrase } from './index';

const p = (en: string, ar: string): Phrase => ({ en, ar });
const both = (en: string, ar: string): Entry => ({ both: p(en, ar) });
const first = (en: string, ar: string): Entry => ({ initial: p(en, ar) });
const later = (en: string, ar: string): Entry => ({ followUp: p(en, ar) });
const each = (initial: Phrase, followUp: Phrase): Entry => ({ initial, followUp });

export const V1: Readonly<Record<string, Entry>> = Object.freeze({
  // -------------------------------------------------------------------------
  // Headings
  // -------------------------------------------------------------------------
  'heading.client': both('Client Information:', 'معلومات العميل:'),
  'heading.recording': both('Recording Information:', 'معلومات التسجيل:'),
  'heading.overview': both('QEEG Overview:', 'نظرة عامة على خريطة الدماغ (QEEG):'),
  'heading.findings': both('Key Findings:', 'النتائج الرئيسية:'),
  'heading.focus': both('Primary Areas of Focus:', 'مجالات التركيز الأساسية:'),
  'heading.brain': both('Understanding Your Brain:', 'فهم دماغك:'),
  'heading.dashboard': both('Performance Dashboard', 'لوحة الأداء'),
  'heading.recommendations': both('Personalised Recommendations:', 'توصيات مخصصة:'),
  'heading.summary': both('Summary:', 'الملخص:'),
  'heading.benefits': both('Potential Benefits:', 'الفوائد المحتملة:'),
  'heading.programme': both('Personalised Programme Recommendations:', 'توصيات البرنامج المخصصة:'),
  'heading.approach': each(
    p('Initial Training Approach', 'نهج التدريب الأولي'),
    p('Next Stage of Training', 'المرحلة التالية من التدريب'),
  ),
  'heading.change': later('What Has Changed', 'ما الذي تغير'),
  'heading.before_after': later('Before and After', 'قبل وبعد'),
  'heading.change_table': later(
    'Estimated Change by Frequency Band',
    'التغير التقديري بحسب نطاق التردد',
  ),

  // -------------------------------------------------------------------------
  // The details at the head of the report
  // -------------------------------------------------------------------------
  'label.name': both('Name', 'الاسم'),
  'label.age': both('Age', 'العمر'),
  'label.sex': both('Gender', 'الجنس'),
  'label.handedness': both('Handedness', 'اليد المفضلة'),
  'label.eyes': both('Eyes', 'العينان'),
  'label.date': both('Date', 'التاريخ'),
  'label.assessment': both('Assessment', 'التقييم'),
  'label.compared_with': later('Compared with', 'بالمقارنة مع'),
  'label.maps': both('Brain maps', 'خرائط الدماغ'),
  'label.sessions': both('Number of sessions', 'عدد الجلسات'),

  'value.sex.female': both('Female', 'أنثى'),
  'value.sex.male': both('Male', 'ذكر'),
  'value.handedness.right': both('Right', 'اليمنى'),
  'value.handedness.left': both('Left', 'اليسرى'),
  'value.handedness.ambidextrous': both('Ambidextrous', 'كلتا اليدين'),
  'value.eyes.closed': both('Closed', 'مغلقتان'),
  'value.eyes.open': both('Open', 'مفتوحتان'),
  'value.eyes.closed_and_open': both('Closed and Open', 'مغلقتان ومفتوحتان'),
  'value.stage.initial': both('Initial QEEG', 'تقييم خريطة الدماغ الأولي'),
  'value.stage.follow_up': both('Follow-up QEEG', 'تقييم المتابعة لخريطة الدماغ'),
  'value.stage.final': both('Final QEEG', 'تقييم خريطة الدماغ النهائي'),

  // -------------------------------------------------------------------------
  // The paragraphs
  // -------------------------------------------------------------------------
  'text.overview': each(
    p(
      'The QEEG assessment identified the primary patterns of brain activity observed during the recording. The findings summarised below provide an overview of the results and have been considered alongside your background and presenting concerns when developing your neurofeedback programme.',
      'حدد تقييم خريطة الدماغ (QEEG) الأنماط الأساسية لنشاط الدماغ التي لوحظت أثناء التسجيل. وتقدم النتائج الملخصة أدناه نظرة عامة على نتائج التقييم، وقد روعيت إلى جانب خلفيتك وما يشغلك حاليا عند إعداد برنامج الارتجاع العصبي الخاص بك.',
    ),
    p(
      'This follow-up QEEG assessment compares the current recording with the {earlier} to evaluate changes in patterns of brain activity over the course of the neurofeedback programme. The findings below provide an overview of areas showing improvement, stability or continued difference and should be considered alongside the client’s reported progress, background and presenting goals.',
      'يقارن تقييم المتابعة لخريطة الدماغ (QEEG) التسجيل الحالي مع {earlier} لتقييم التغيرات في أنماط نشاط الدماغ على مدار برنامج الارتجاع العصبي. وتقدم النتائج أدناه نظرة عامة على الجوانب التي أظهرت تحسنا أو استقرارا أو اختلافا مستمرا، وينبغي النظر إليها إلى جانب ما أفاد به العميل من تقدم وخلفيته وأهدافه الحالية.',
    ),
  ),
  'text.findings': each(
    p(
      'The following findings summarise the main patterns of brain activity identified during your QEEG assessment. These observations provide an overview of the primary areas that may be contributing to your current concerns and goals.',
      'تلخص النتائج التالية الأنماط الرئيسية لنشاط الدماغ التي تم تحديدها خلال تقييم خريطة الدماغ الخاص بك. وتقدم هذه الملاحظات نظرة عامة على الجوانب الأساسية التي قد تسهم في ما يشغلك حاليا وفي أهدافك.',
    ),
    p(
      'The following findings summarise the main changes observed between the {earlier} and the follow-up QEEG. These findings highlight areas of improvement, areas that have remained relatively stable and areas that may continue to benefit from further training.',
      'تلخص النتائج التالية أبرز التغيرات التي لوحظت بين {earlier} وتقييم المتابعة. وتبرز هذه النتائج جوانب التحسن، والجوانب التي بقيت مستقرة نسبيا، والجوانب التي قد تستمر في الاستفادة من مزيد من التدريب.',
    ),
  ),
  'text.focus': each(
    p(
      'The following areas have been identified as the primary focus of your personalised neurofeedback programme. These priorities have been selected to support your individual goals and guide your training throughout the programme.',
      'تم تحديد المجالات التالية بوصفها محور التركيز الأساسي لبرنامج الارتجاع العصبي المخصص لك. وقد اختيرت هذه الأولويات لدعم أهدافك الفردية وتوجيه تدريبك على مدار البرنامج.',
    ),
    p(
      'Based on the follow-up QEEG findings and the client’s reported progress, the following areas have been identified as priorities for the next stage of the neurofeedback programme.',
      'استنادا إلى نتائج تقييم المتابعة لخريطة الدماغ وما أفاد به العميل من تقدم، تم تحديد المجالات التالية بوصفها أولويات المرحلة التالية من برنامج الارتجاع العصبي.',
    ),
  ),
  'text.dashboard': both(
    'Six dimensions of cognitive performance, each measured against its optimal range and translated into what it means for you.',
    'ستة أبعاد للأداء المعرفي، يقاس كل منها مقارنة بنطاقه الأمثل ويترجم إلى ما يعنيه ذلك بالنسبة لك.',
  ),
  'text.recommendations': both(
    'The following recommendations highlight practical areas to focus on alongside your personalised neurofeedback programme.',
    'تسلط التوصيات التالية الضوء على جوانب عملية ينصح بالتركيز عليها إلى جانب برنامج الارتجاع العصبي المخصص لك.',
  ),
  'text.summary_lead': later(
    'The follow-up QEEG demonstrates changes in brain activity compared with the {earlier}. These findings should not be viewed in isolation and are considered alongside the client’s functional progress and reported changes throughout the neurofeedback programme. Areas showing continued difference may help guide the next stage of training.',
    'يظهر تقييم المتابعة لخريطة الدماغ تغيرات في نشاط الدماغ مقارنة مع {earlier}. ولا ينبغي النظر إلى هذه النتائج بمعزل عن غيرها، بل تؤخذ إلى جانب ما أحرزه العميل من تقدم وظيفي وما أفاد به من تغيرات على مدار برنامج الارتجاع العصبي. وقد تساعد الجوانب التي ما زالت تظهر اختلافا في توجيه المرحلة التالية من التدريب.',
  ),
  'text.programme': each(
    p(
      'Based on your QEEG findings, background and presenting concerns, the following neurofeedback programme has been recommended to support your individual goals. As training progresses, your programme may be adjusted to ensure it remains tailored to your needs and response to training.',
      'استنادا إلى نتائج خريطة الدماغ وخلفيتك وما يشغلك حاليا، يوصى ببرنامج الارتجاع العصبي التالي لدعم أهدافك الفردية. ومع تقدم التدريب، قد يعدل برنامجك لضمان بقائه ملائما لاحتياجاتك واستجابتك للتدريب.',
    ),
    p(
      'Based on the follow-up QEEG findings and your reported progress, the following continued neurofeedback programme has been recommended to support your individual goals. As training progresses, your programme may be adjusted to ensure it remains tailored to your needs and response to training.',
      'استنادا إلى نتائج تقييم المتابعة لخريطة الدماغ وما أبلغتنا به من تقدم، يوصى بمواصلة برنامج الارتجاع العصبي على النحو التالي لدعم أهدافك الفردية. ومع تقدم التدريب، قد يعدل برنامجك لضمان بقائه ملائما لاحتياجاتك واستجابتك للتدريب.',
    ),
  ),
  'text.programme_length': each(
    p(
      'The following programme length has been recommended to provide the best opportunity for meaningful and lasting improvements in brain function.',
      'يوصى بمدة البرنامج التالية لإتاحة أفضل فرصة لتحقيق تحسنات ملموسة ودائمة في وظائف الدماغ.',
    ),
    p(
      'The following continued programme has been recommended to build on the progress made so far.',
      'يوصى بمواصلة البرنامج بالمدة التالية للبناء على ما تحقق من تقدم حتى الآن.',
    ),
  ),
  'text.approach': each(
    p(
      'Training will begin using the approach below to establish a strong foundation before progressing to more targeted neurofeedback training.',
      'سيبدأ التدريب باستخدام النهج الموضح أدناه لإرساء أساس متين قبل الانتقال إلى تدريب ارتجاع عصبي أكثر استهدافا.',
    ),
    p(
      'The next stage of training will follow the approach below, guided by the follow-up findings.',
      'ستتبع المرحلة التالية من التدريب النهج الموضح أدناه، في ضوء نتائج تقييم المتابعة.',
    ),
  ),
  'text.approach_line': both('**{label}:** {text}', '**{label}:** {text}'),
  'text.monitoring': both(
    'Your progress will be monitored throughout your neurofeedback programme, and your training plan may be adjusted as your brain responds to training. For the most effective results, neurofeedback is generally recommended 2–3 times per week, although this may vary depending on your individual needs and goals.',
    'ستتم متابعة تقدمك على مدار برنامج الارتجاع العصبي، وقد تعدل خطة تدريبك مع استجابة دماغك للتدريب. ولتحقيق أفضل النتائج، ينصح عموما بإجراء جلسات الارتجاع العصبي بمعدل مرتين إلى ثلاث مرات أسبوعيا، وقد يختلف ذلك بحسب احتياجاتك وأهدافك الفردية.',
  ),
  'text.gradual': both(
    'Neurofeedback is a gradual learning process, and progress varies between individuals. Your training plan will continue to be personalised throughout the programme to ensure the most effective outcome.',
    'الارتجاع العصبي عملية تعلم تدريجية، ويختلف التقدم من شخص إلى آخر. وستستمر مواءمة خطة تدريبك على مدار البرنامج لضمان أفضل نتيجة ممكنة.',
  ),
  'text.final_note': both(
    '**Final Note:** Every brain is unique, and no two QEEG assessments are the same. Neurofeedback is a personalised process, and your training plan will be adjusted throughout training based on your progress, the changes you notice and your response to sessions. This report is confidential and intended solely for the named client.',
    '**ملاحظة أخيرة:** كل دماغ فريد بطبيعته، ولا يتطابق أي تقييمين لخريطة الدماغ. الارتجاع العصبي عملية مخصصة، وستعدل خطة تدريبك أثناء التدريب بناء على تقدمك وما تلاحظه من تغيرات واستجابتك للجلسات. هذا التقرير سري ومخصص حصريا للعميل المذكور بالاسم.',
  ),
  'text.none_selected': both('None selected.', 'لم يحدد شيء.'),

  'term.earlier.initial': later('initial QEEG', 'تقييم خريطة الدماغ الأولي'),
  'term.earlier.previous': later('previous QEEG', 'تقييم خريطة الدماغ السابق'),

  // -------------------------------------------------------------------------
  // Key findings
  // -------------------------------------------------------------------------
  'finding.brainwave_dysregulation': both(
    'Brainwave Dysregulation',
    'اختلال تنظيم الموجات الدماغية',
  ),
  'finding.altered_brain_communication': both(
    'Altered Brain Communication',
    'تغير في التواصل بين مناطق الدماغ',
  ),
  'finding.reduced_cognitive_efficiency': both(
    'Reduced Cognitive Efficiency',
    'انخفاض الكفاءة المعرفية',
  ),
  'finding.reduced_attention_focus': both('Reduced Attention & Focus', 'انخفاض الانتباه والتركيز'),
  'finding.mental_fatigue': both('Mental Fatigue', 'الإجهاد الذهني'),
  'finding.increased_stress_response': both('Increased Stress Response', 'ازدياد الاستجابة للتوتر'),
  'finding.reduced_emotional_regulation': both(
    'Reduced Emotional Regulation',
    'انخفاض القدرة على التنظيم الانفعالي',
  ),
  'finding.sleep_dysregulation': both('Sleep Dysregulation', 'اختلال تنظيم النوم'),
  'finding.reduced_recovery_capacity': both(
    'Reduced Recovery Capacity',
    'انخفاض القدرة على التعافي',
  ),
  'finding.reduced_mental_energy': both('Reduced Mental Energy', 'انخفاض الطاقة الذهنية'),

  // -------------------------------------------------------------------------
  // Primary areas of focus
  // -------------------------------------------------------------------------
  'focus.brainwave_regulation': both('Brainwave Regulation', 'تنظيم الموجات الدماغية'),
  'focus.brain_communication': both('Brain Communication', 'التواصل بين مناطق الدماغ'),
  'focus.attention_focus': both('Attention & Focus', 'الانتباه والتركيز'),
  'focus.cognitive_efficiency': both('Cognitive Efficiency', 'الكفاءة المعرفية'),
  'focus.memory_function': both('Memory Function', 'وظائف الذاكرة'),
  'focus.emotional_regulation': both('Emotional Regulation', 'التنظيم الانفعالي'),
  'focus.stress_regulation': both('Stress Regulation', 'تنظيم التوتر'),
  'focus.nervous_system_regulation': both('Nervous System Regulation', 'تنظيم الجهاز العصبي'),
  'focus.sleep_recovery': both('Sleep & Recovery', 'النوم والتعافي'),
  'focus.mental_energy': both('Mental Energy', 'الطاقة الذهنية'),
  'focus.performance_optimisation': both('Performance Optimisation', 'تحسين الأداء'),

  // -------------------------------------------------------------------------
  // Regions: the name on the form, and the words inside a sentence
  // -------------------------------------------------------------------------
  'region.frontal.label': both('Frontal Regions', 'المناطق الجبهية'),
  'region.frontal.phrase': both('frontal regions', 'المناطق الجبهية'),
  'region.central.label': both('Central Regions', 'المناطق المركزية'),
  'region.central.phrase': both('central regions', 'المناطق المركزية'),
  'region.temporal.label': both('Temporal Regions', 'المناطق الصدغية'),
  'region.temporal.phrase': both('temporal regions', 'المناطق الصدغية'),
  'region.parietal.label': both('Parietal Regions', 'المناطق الجدارية'),
  'region.parietal.phrase': both('parietal regions', 'المناطق الجدارية'),
  'region.occipital.label': both('Occipital Regions', 'المناطق القذالية'),
  'region.occipital.phrase': both('occipital regions', 'المناطق القذالية'),
  'region.left_hemisphere.label': both('Left Hemisphere', 'نصف الكرة المخية الأيسر'),
  'region.left_hemisphere.phrase': both('left hemisphere', 'نصف الكرة المخية الأيسر'),
  'region.right_hemisphere.label': both('Right Hemisphere', 'نصف الكرة المخية الأيمن'),
  'region.right_hemisphere.phrase': both('right hemisphere', 'نصف الكرة المخية الأيمن'),
  'region.bilateral.label': both('Bilateral', 'مناطق في كلا الجانبين'),
  'region.bilateral.phrase': both('bilateral regions', 'مناطق في كلا الجانبين'),
  'region.widespread.label': both('Diffuse / Widespread', 'مناطق واسعة الانتشار'),
  'region.widespread.phrase': both('widespread regions', 'مناطق واسعة الانتشار'),

  /** How a list of regions is joined: "a, b and c". */
  'list.between': both(', ', '، '),
  'list.before_last': both(' and ', ' و'),

  // -------------------------------------------------------------------------
  // The five bands
  // -------------------------------------------------------------------------
  'label.associated': both('Associated with:', 'يرتبط بما يلي:'),
  'label.influence': both('May influence:', 'قد يؤثر في:'),
  'band.with_range': both('{name} ({from}–{to} Hz)', '{name} (من {from} إلى {to} هرتز)'),

  'band.delta.name': both('Delta', 'دلتا'),
  'band.delta.associated': both(
    'Deep sleep, restoration and recovery',
    'النوم العميق وتجدد النشاط والتعافي',
  ),
  'band.delta.influence': both(
    'Alertness, attention and mental processing',
    'اليقظة والانتباه والمعالجة الذهنية',
  ),
  'band.theta.name': both('Theta', 'ثيتا'),
  'band.theta.associated': both(
    'Relaxation, learning, memory and creativity',
    'الاسترخاء والتعلم والذاكرة والإبداع',
  ),
  'band.theta.influence': both(
    'Concentration and information processing',
    'التركيز ومعالجة المعلومات',
  ),
  'band.alpha.name': both('Alpha', 'ألفا'),
  'band.alpha.associated': both('Calm, relaxed awareness', 'الهدوء والوعي المسترخي'),
  'band.alpha.influence': both(
    'Relaxation, attention and brain regulation',
    'الاسترخاء والانتباه وتنظيم نشاط الدماغ',
  ),
  'band.beta.name': both('Beta', 'بيتا'),
  'band.beta.associated': both(
    'Focus, thinking and problem-solving',
    'التركيز والتفكير وحل المشكلات',
  ),
  'band.beta.influence': both(
    'Attention, mental efficiency and concentration',
    'الانتباه والكفاءة الذهنية والتركيز',
  ),
  'band.high_beta.name': both('High Beta', 'بيتا المرتفعة'),
  'band.high_beta.associated': both(
    'Heightened alertness and mental effort',
    'اليقظة الشديدة والجهد الذهني المرتفع',
  ),
  'band.high_beta.influence': both(
    'Stress regulation and mental tension',
    'تنظيم التوتر والشد الذهني',
  ),

  // A first report: what was seen in a band.
  'level.band.increased.label': first('Increased', 'متزايد'),
  'level.band.increased.word': first('Increased', 'متزايد'),
  'level.band.reduced.label': first('Reduced', 'منخفض'),
  'level.band.reduced.word': first('Reduced', 'منخفض'),
  'level.band.within_normal_limits.label': first('Within normal limits', 'ضمن الحدود الطبيعية'),
  'level.band.within_normal_limits.word': first('within normal limits', 'ضمن الحدود الطبيعية'),
  'sentence.band.level': first('**{level}** activity', 'نشاط **{level}**'),
  'sentence.band.normal': first(
    'Activity **within normal limits**',
    'النشاط **ضمن الحدود الطبيعية**',
  ),

  // A follow-up: what changed in a band.
  'change.band.improved.label': later('Improved', 'تحسن'),
  'change.band.improved.sentence': later('**Improved** activity', 'نشاط **متحسن**'),
  'change.band.further_improved.label': later(
    'Further improved / moving towards normal limits',
    'تحسن إضافي / يقترب من الحدود الطبيعية',
  ),
  'change.band.further_improved.sentence': later(
    '**Further improved** activity, moving towards normal limits',
    'نشاط **ازداد تحسنا** ويقترب من الحدود الطبيعية',
  ),
  'change.band.unchanged.label': later('Unchanged / broadly stable', 'دون تغير / مستقر عموما'),
  'change.band.unchanged.sentence': later(
    'Activity **unchanged and broadly stable**',
    'النشاط **دون تغير ومستقر عموما**',
  ),
  'change.band.moved_further.label': later(
    'Worsened / moved further from normal limits',
    'تراجع / ابتعد عن الحدود الطبيعية',
  ),
  'change.band.moved_further.sentence': later(
    'Activity has **moved further from normal limits**',
    'النشاط **ابتعد عن الحدود الطبيعية**',
  ),
  'change.band.now_within_normal_limits.label': later(
    'Now within normal limits',
    'أصبح ضمن الحدود الطبيعية',
  ),
  'change.band.now_within_normal_limits.sentence': later(
    'Activity is **now within normal limits**',
    'النشاط **أصبح ضمن الحدود الطبيعية**',
  ),

  /** The end of a sentence about a band, when regions were chosen. */
  'clause.band.involving': both(
    ', primarily involving the **{regions}**',
    '، يشمل بشكل رئيسي **{regions}**',
  ),
  'clause.band.across': both(', across the **{regions}**', ' عبر **{regions}**'),
  'sentence.end': both('.', '.'),

  // -------------------------------------------------------------------------
  // Connectivity, amplitude asymmetry, phase lag
  // -------------------------------------------------------------------------
  'label.findings': both('Findings:', 'النتائج:'),

  'connectivity.connectivity.title': both('Connectivity', 'الترابط الوظيفي'),
  'connectivity.connectivity.description': both(
    'Measures how effectively different parts of the brain communicate with one another.',
    'يقيس مدى فعالية تواصل مناطق الدماغ المختلفة فيما بينها.',
  ),
  'connectivity.asymmetry.title': both('Amplitude Asymmetry', 'عدم تماثل السعة'),
  'connectivity.asymmetry.description': both(
    'Whether the left and right sides of the brain are working in a balanced way.',
    'ما إذا كان الجانبان الأيسر والأيمن من الدماغ يعملان بطريقة متوازنة.',
  ),
  'connectivity.phase_lag.title': both('Phase Lag', 'تأخر الطور'),
  'connectivity.phase_lag.description': both(
    'How efficiently information is timed as it travels between different brain regions.',
    'مدى كفاءة توقيت انتقال المعلومات بين مناطق الدماغ المختلفة.',
  ),

  // A first report.
  'sentence.connectivity': first(
    'Connectivity analysis demonstrated **{level}** communication between selected brain regions',
    'أظهر تحليل الترابط الوظيفي تواصلا **{level}** بين مناطق الدماغ المحددة',
  ),
  'sentence.asymmetry': first(
    'Amplitude asymmetry demonstrated **{level}** hemispheric differences',
    'أظهر تحليل عدم تماثل السعة فروقا بين نصفي الكرة المخية **{level}**',
  ),
  'sentence.phase_lag': first(
    'Phase lag analysis demonstrated **{level}** timing of communication between selected brain regions',
    'أظهر تحليل تأخر الطور توقيتا **{level}** للتواصل بين مناطق الدماغ المحددة',
  ),
  'clause.connectivity.involving': both(
    ', with findings involving the **{regions}**',
    '، مع نتائج تشمل **{regions}**',
  ),
  'clause.asymmetry.involving': both(' involving the **{regions}**', ' وتشمل **{regions}**'),

  'level.connectivity.increased.label': first('Increased', 'متزايد'),
  'level.connectivity.increased.word': first('increased', 'متزايدا'),
  'level.connectivity.reduced.label': first('Reduced', 'منخفض'),
  'level.connectivity.reduced.word': first('reduced', 'منخفضا'),
  'level.connectivity.mixed.label': first('Mixed', 'متباين'),
  'level.connectivity.mixed.word': first('mixed', 'متباينا'),
  'level.asymmetry.left.label': first('Left', 'الجانب الأيسر'),
  'level.asymmetry.left.word': first('left', 'تميل إلى الجانب الأيسر'),
  'level.asymmetry.right.label': first('Right', 'الجانب الأيمن'),
  'level.asymmetry.right.word': first('right', 'تميل إلى الجانب الأيمن'),
  'level.asymmetry.bilateral.label': first('Bilateral', 'كلا الجانبين'),
  'level.asymmetry.bilateral.word': first('bilateral', 'في كلا الجانبين'),
  'level.phase_lag.normal.label': first('Normal', 'طبيعي'),
  'level.phase_lag.normal.word': first('normal', 'طبيعيا'),
  'level.phase_lag.delayed.label': first('Delayed', 'متأخر'),
  'level.phase_lag.delayed.word': first('delayed', 'متأخرا'),
  'level.phase_lag.altered.label': first('Altered', 'متغير'),
  'level.phase_lag.altered.word': first('altered', 'متغيرا'),

  // A follow-up. Each sentence ends with `clause.connectivity.involving` when
  // regions were chosen, and with `sentence.end` always.
  'change.connectivity.improved.label': later('Improved / more regulated', 'تحسن / أكثر انتظاما'),
  'change.connectivity.improved.sentence': later(
    'Connectivity analysis demonstrated **improved, more regulated** communication between selected brain regions',
    'أظهر تحليل الترابط الوظيفي تواصلا **متحسنا وأكثر انتظاما** بين مناطق الدماغ المحددة',
  ),
  'change.connectivity.unchanged.label': later(
    'Unchanged / broadly stable',
    'دون تغير / مستقر عموما',
  ),
  'change.connectivity.unchanged.sentence': later(
    'Connectivity analysis demonstrated communication between selected brain regions that is **unchanged and broadly stable**',
    'أظهر تحليل الترابط الوظيفي أن التواصل بين مناطق الدماغ المحددة **دون تغير ومستقر عموما**',
  ),
  'change.connectivity.moved_further.label': later(
    'Worsened / less regulated',
    'تراجع / أقل انتظاما',
  ),
  'change.connectivity.moved_further.sentence': later(
    'Connectivity analysis demonstrated **less regulated** communication between selected brain regions',
    'أظهر تحليل الترابط الوظيفي تواصلا **أقل انتظاما** بين مناطق الدماغ المحددة',
  ),
  'change.connectivity.mixed_changes.label': later('Mixed changes', 'تغيرات متباينة'),
  'change.connectivity.mixed_changes.sentence': later(
    'Connectivity analysis demonstrated **mixed changes** in communication between selected brain regions',
    'أظهر تحليل الترابط الوظيفي **تغيرات متباينة** في التواصل بين مناطق الدماغ المحددة',
  ),
  'change.connectivity.now_within_normal_limits.label': later(
    'Now within normal limits',
    'أصبح ضمن الحدود الطبيعية',
  ),
  'change.connectivity.now_within_normal_limits.sentence': later(
    'Connectivity analysis demonstrated communication between selected brain regions that is **now within normal limits**',
    'أظهر تحليل الترابط الوظيفي أن التواصل بين مناطق الدماغ المحددة **أصبح ضمن الحدود الطبيعية**',
  ),

  'change.asymmetry.improved.label': later(
    'Improved / reduced asymmetry',
    'تحسن / انخفاض عدم التماثل',
  ),
  'change.asymmetry.improved.sentence': later(
    'Amplitude asymmetry demonstrated **improved balance and reduced asymmetry**',
    'أظهر تحليل عدم تماثل السعة **توازنا متحسنا وانخفاضا في عدم التماثل**',
  ),
  'change.asymmetry.unchanged.label': later('Unchanged / broadly stable', 'دون تغير / مستقر عموما'),
  'change.asymmetry.unchanged.sentence': later(
    'Amplitude asymmetry is **unchanged and broadly stable**',
    'عدم تماثل السعة **دون تغير ومستقر عموما**',
  ),
  'change.asymmetry.moved_further.label': later(
    'Worsened / increased asymmetry',
    'تراجع / ازدياد عدم التماثل',
  ),
  'change.asymmetry.moved_further.sentence': later(
    'Amplitude asymmetry demonstrated **increased asymmetry**',
    'أظهر تحليل عدم تماثل السعة **ازديادا في عدم التماثل**',
  ),
  'change.asymmetry.mixed_changes.label': later('Mixed changes', 'تغيرات متباينة'),
  'change.asymmetry.mixed_changes.sentence': later(
    'Amplitude asymmetry demonstrated **mixed changes**',
    'أظهر تحليل عدم تماثل السعة **تغيرات متباينة**',
  ),
  'change.asymmetry.now_within_normal_limits.label': later(
    'Now within normal limits',
    'أصبح ضمن الحدود الطبيعية',
  ),
  'change.asymmetry.now_within_normal_limits.sentence': later(
    'Amplitude asymmetry is **now within normal limits**',
    'عدم تماثل السعة **أصبح ضمن الحدود الطبيعية**',
  ),

  'change.phase_lag.improved.label': later(
    'Improved / moving towards normal limits',
    'تحسن / يقترب من الحدود الطبيعية',
  ),
  'change.phase_lag.improved.sentence': later(
    'Phase lag analysis demonstrated **improved** timing of communication, moving towards normal limits',
    'أظهر تحليل تأخر الطور توقيتا **متحسنا** للتواصل يقترب من الحدود الطبيعية',
  ),
  'change.phase_lag.unchanged.label': later('Unchanged / broadly stable', 'دون تغير / مستقر عموما'),
  'change.phase_lag.unchanged.sentence': later(
    'Phase lag analysis demonstrated timing of communication that is **unchanged and broadly stable**',
    'أظهر تحليل تأخر الطور أن توقيت التواصل **دون تغير ومستقر عموما**',
  ),
  'change.phase_lag.moved_further.label': later(
    'Worsened / moved further from normal limits',
    'تراجع / ابتعد عن الحدود الطبيعية',
  ),
  'change.phase_lag.moved_further.sentence': later(
    'Phase lag analysis demonstrated timing of communication that has **moved further from normal limits**',
    'أظهر تحليل تأخر الطور أن توقيت التواصل **ابتعد عن الحدود الطبيعية**',
  ),
  'change.phase_lag.mixed_changes.label': later('Mixed changes', 'تغيرات متباينة'),
  'change.phase_lag.mixed_changes.sentence': later(
    'Phase lag analysis demonstrated **mixed changes** in the timing of communication',
    'أظهر تحليل تأخر الطور **تغيرات متباينة** في توقيت التواصل',
  ),
  'change.phase_lag.now_within_normal_limits.label': later(
    'Now within normal limits',
    'أصبح ضمن الحدود الطبيعية',
  ),
  'change.phase_lag.now_within_normal_limits.sentence': later(
    'Phase lag analysis demonstrated timing of communication that is **now within normal limits**',
    'أظهر تحليل تأخر الطور أن توقيت التواصل **أصبح ضمن الحدود الطبيعية**',
  ),

  // -------------------------------------------------------------------------
  // The performance dashboard
  // -------------------------------------------------------------------------
  'tier.low': both('Significant Finding', 'نتيجة مهمة'),
  'tier.middle': both('Opportunity Area', 'مجال للتحسين'),
  'tier.high': both('Optimal Range', 'النطاق الأمثل'),
  'label.out_of_ten': both('/10', '/10'),
  'label.earlier_score': later('was {score}', 'كان {score}'),
  'label.evidence': both('EEG evidence', 'دلائل تخطيط الدماغ'),
  'label.meaning': both('What this may mean', 'ما قد يعنيه ذلك'),
  'label.advice': both('Recommendation:', 'التوصية:'),

  'dimension.mental_energy.title': both('Mental Energy', 'الطاقة الذهنية'),
  'dimension.mental_energy.low.summary': both(
    'The brain appears to be using slower processing patterns than expected during wakefulness.',
    'يبدو أن الدماغ يعتمد أنماط معالجة أبطأ من المتوقع أثناء اليقظة.',
  ),
  'dimension.mental_energy.low.point.1': both(
    'Brain fog and mental fatigue',
    'ضبابية ذهنية وإجهاد ذهني',
  ),
  'dimension.mental_energy.low.point.2': both(
    'Reduced sharpness under pressure',
    'انخفاض الحدة الذهنية تحت الضغط',
  ),
  'dimension.mental_energy.low.point.3': both(
    'More effort required for complex thinking',
    'الحاجة إلى جهد أكبر في التفكير المركب',
  ),
  'dimension.mental_energy.low.advice': both(
    'Prioritise recovery-focused neurofeedback training alongside rest and energy management.',
    'إعطاء الأولوية لتدريب الارتجاع العصبي الموجه للتعافي إلى جانب الراحة وإدارة الطاقة.',
  ),
  'dimension.mental_energy.middle.summary': both(
    'Mental energy is broadly available but may fluctuate across the day.',
    'الطاقة الذهنية متوفرة عموما لكنها قد تتذبذب خلال اليوم.',
  ),
  'dimension.mental_energy.middle.point.1': both(
    'Energy dips during longer tasks',
    'انخفاض الطاقة أثناء المهام الطويلة',
  ),
  'dimension.mental_energy.middle.point.2': both(
    'Occasional loss of mental sharpness',
    'فقدان الحدة الذهنية أحيانا',
  ),
  'dimension.mental_energy.middle.point.3': both(
    'Greater effort required later in the day',
    'الحاجة إلى جهد أكبر في أواخر اليوم',
  ),
  'dimension.mental_energy.middle.advice': both(
    'Support consistency of energy through pacing, sleep routine and targeted training.',
    'دعم ثبات الطاقة من خلال تنظيم الإيقاع اليومي وروتين النوم والتدريب الموجه.',
  ),
  'dimension.mental_energy.high.summary': both(
    'Mental energy appears well supported and consistently available.',
    'تبدو الطاقة الذهنية مدعومة جيدا ومتوفرة باستمرار.',
  ),
  'dimension.mental_energy.high.point.1': both(
    'Sustained alertness through the day',
    'يقظة مستمرة على مدار اليوم',
  ),
  'dimension.mental_energy.high.point.2': both(
    'Capacity for extended mental effort',
    'قدرة على جهد ذهني مطول',
  ),
  'dimension.mental_energy.high.point.3': both(
    'Reserves available under increased demand',
    'احتياطات متاحة عند ازدياد المتطلبات',
  ),
  'dimension.mental_energy.high.advice': both(
    'Maintain current routines and reinforce what is already working well.',
    'الحفاظ على الروتين الحالي وتعزيز ما يعمل جيدا بالفعل.',
  ),

  'dimension.attention_focus.title': both('Attention & Focus', 'الانتباه والتركيز'),
  'dimension.attention_focus.low.summary': both(
    'Attention systems may require greater effort than expected to establish and hold focus.',
    'قد تتطلب أنظمة الانتباه جهدا أكبر من المتوقع لتأسيس التركيز والحفاظ عليه.',
  ),
  'dimension.attention_focus.low.point.1': both(
    'Increased distractibility during fatigue',
    'ازدياد التشتت عند التعب',
  ),
  'dimension.attention_focus.low.point.2': both(
    'Difficulty sustaining concentration',
    'صعوبة في الحفاظ على التركيز',
  ),
  'dimension.attention_focus.low.point.3': both(
    'Reduced cognitive endurance',
    'انخفاض التحمل المعرفي',
  ),
  'dimension.attention_focus.low.advice': both(
    'Improve neural efficiency through targeted training and a lower-distraction environment.',
    'تحسين الكفاءة العصبية من خلال التدريب الموجه وبيئة أقل تشتيتا.',
  ),
  'dimension.attention_focus.middle.summary': both(
    'Focus is generally available but may take more effort to sustain during longer tasks.',
    'التركيز متاح عموما لكنه قد يتطلب جهدا أكبر للاستمرار في المهام الطويلة.',
  ),
  'dimension.attention_focus.middle.point.1': both(
    'Attention drifts on repetitive work',
    'شرود الانتباه في الأعمال المتكررة',
  ),
  'dimension.attention_focus.middle.point.2': both(
    'Focus recovers slowly after interruption',
    'بطء استعادة التركيز بعد المقاطعة',
  ),
  'dimension.attention_focus.middle.point.3': both(
    'Performance varies with fatigue',
    'تفاوت الأداء مع التعب',
  ),
  'dimension.attention_focus.middle.advice': both(
    'Build consistent focus habits and train sustained attention in short, regular blocks.',
    'بناء عادات تركيز ثابتة وتدريب الانتباه المستمر في فترات قصيرة منتظمة.',
  ),
  'dimension.attention_focus.high.summary': both(
    'Attention and concentration appear well regulated across varied demands.',
    'يبدو الانتباه والتركيز منظمين جيدا عبر مختلف المتطلبات.',
  ),
  'dimension.attention_focus.high.point.1': both(
    'Focus established quickly',
    'تأسيس التركيز بسرعة',
  ),
  'dimension.attention_focus.high.point.2': both(
    'Concentration sustained over time',
    'استمرار التركيز مع مرور الوقت',
  ),
  'dimension.attention_focus.high.point.3': both(
    'Resistant to routine distraction',
    'مقاومة للمشتتات المعتادة',
  ),
  'dimension.attention_focus.high.advice': both(
    'Maintain existing focus habits and protect them during periods of higher load.',
    'الحفاظ على عادات التركيز الحالية وحمايتها في فترات الضغط المرتفع.',
  ),

  'dimension.cognitive_flexibility.title': both(
    'Cognitive Efficiency & Flexibility',
    'الكفاءة والمرونة المعرفية',
  ),
  'dimension.cognitive_flexibility.low.summary': both(
    'Information may not move through networks as efficiently as expected.',
    'قد لا تنتقل المعلومات عبر الشبكات العصبية بالكفاءة المتوقعة.',
  ),
  'dimension.cognitive_flexibility.low.point.1': both(
    'Slower switching between tasks',
    'بطء في التنقل بين المهام',
  ),
  'dimension.cognitive_flexibility.low.point.2': both(
    'Reduced adaptability under pressure',
    'انخفاض القدرة على التكيف تحت الضغط',
  ),
  'dimension.cognitive_flexibility.low.point.3': both(
    'Greater effort during complex decisions',
    'جهد أكبر أثناء القرارات المركبة',
  ),
  'dimension.cognitive_flexibility.low.advice': both(
    'Target network efficiency and communication timing through neurofeedback.',
    'استهداف كفاءة الشبكات العصبية وتوقيت التواصل من خلال الارتجاع العصبي.',
  ),
  'dimension.cognitive_flexibility.middle.summary': both(
    'Processing is broadly efficient, though adaptability may reduce under higher demand.',
    'المعالجة فعالة عموما، غير أن القدرة على التكيف قد تنخفض عند ازدياد المتطلبات.',
  ),
  'dimension.cognitive_flexibility.middle.point.1': both(
    'Task switching costs more effort when busy',
    'التنقل بين المهام يتطلب جهدا أكبر عند الانشغال',
  ),
  'dimension.cognitive_flexibility.middle.point.2': both(
    'Occasional difficulty changing approach',
    'صعوبة أحيانا في تغيير الأسلوب',
  ),
  'dimension.cognitive_flexibility.middle.point.3': both(
    'Efficiency drops as load increases',
    'انخفاض الكفاءة مع ازدياد العبء',
  ),
  'dimension.cognitive_flexibility.middle.advice': both(
    'Challenge the brain with varied cognitive activities to build flexibility.',
    'تحفيز الدماغ بأنشطة معرفية متنوعة لبناء المرونة.',
  ),
  'dimension.cognitive_flexibility.high.summary': both(
    'Information appears to be processed and adapted efficiently across contexts.',
    'يبدو أن معالجة المعلومات والتكيف معها يجريان بكفاءة عبر السياقات المختلفة.',
  ),
  'dimension.cognitive_flexibility.high.point.1': both(
    'Rapid switching between tasks',
    'تنقل سريع بين المهام',
  ),
  'dimension.cognitive_flexibility.high.point.2': both(
    'Adaptable approach under pressure',
    'أسلوب متكيف تحت الضغط',
  ),
  'dimension.cognitive_flexibility.high.point.3': both(
    'Efficient handling of complex material',
    'تعامل فعال مع المواد المركبة',
  ),
  'dimension.cognitive_flexibility.high.advice': both(
    'Maintain cognitive variety to preserve current flexibility.',
    'الحفاظ على التنوع المعرفي لصون المرونة الحالية.',
  ),

  'dimension.stress_regulation.title': both('Stress Regulation', 'تنظيم التوتر'),
  'dimension.stress_regulation.low.summary': both(
    'The brain’s capacity to regulate stress appears reduced.',
    'تبدو قدرة الدماغ على تنظيم التوتر منخفضة.',
  ),
  'dimension.stress_regulation.low.point.1': both(
    'Feeling depleted by the end of the day',
    'الشعور بالاستنزاف مع نهاية اليوم',
  ),
  'dimension.stress_regulation.low.point.2': both(
    'Reduced resilience to setbacks',
    'انخفاض المرونة تجاه العثرات',
  ),
  'dimension.stress_regulation.low.point.3': both(
    'Increased effort to maintain performance',
    'جهد متزايد للحفاظ على الأداء',
  ),
  'dimension.stress_regulation.low.advice': both(
    'Incorporate daily stress-management techniques alongside regulation-focused training.',
    'إدراج أساليب يومية لإدارة التوتر إلى جانب التدريب الموجه لتنظيم النشاط.',
  ),
  'dimension.stress_regulation.middle.summary': both(
    'Stress regulation is broadly intact but may be tested during sustained pressure.',
    'تنظيم التوتر سليم عموما لكنه قد يختبر أثناء الضغط المستمر.',
  ),
  'dimension.stress_regulation.middle.point.1': both(
    'Slower settling after stressful events',
    'بطء في استعادة الهدوء بعد المواقف الضاغطة',
  ),
  'dimension.stress_regulation.middle.point.2': both(
    'Emotional balance varies with fatigue',
    'تفاوت التوازن الانفعالي مع التعب',
  ),
  'dimension.stress_regulation.middle.point.3': both(
    'Recovery from pressure takes longer',
    'التعافي من الضغط يستغرق وقتا أطول',
  ),
  'dimension.stress_regulation.middle.advice': both(
    'Build daily downregulation habits and monitor cumulative load.',
    'بناء عادات تهدئة يومية ومراقبة العبء التراكمي.',
  ),
  'dimension.stress_regulation.high.summary': both(
    'Stress regulation appears well supported and stable.',
    'يبدو تنظيم التوتر مدعوما جيدا ومستقرا.',
  ),
  'dimension.stress_regulation.high.point.1': both(
    'Settles quickly after pressure',
    'استعادة الهدوء بسرعة بعد الضغط',
  ),
  'dimension.stress_regulation.high.point.2': both(
    'Emotional balance maintained under load',
    'الحفاظ على التوازن الانفعالي تحت العبء',
  ),
  'dimension.stress_regulation.high.point.3': both(
    'Good resilience to daily demands',
    'مرونة جيدة تجاه متطلبات الحياة اليومية',
  ),
  'dimension.stress_regulation.high.advice': both(
    'Maintain current stress-management routines.',
    'الحفاظ على أساليب إدارة التوتر الحالية.',
  ),

  'dimension.recovery_capacity.title': both('Recovery Capacity', 'القدرة على التعافي'),
  'dimension.recovery_capacity.low.summary': both(
    'The nervous system may not be recovering efficiently between periods of effort.',
    'قد لا يتعافى الجهاز العصبي بكفاءة بين فترات الجهد.',
  ),
  'dimension.recovery_capacity.low.point.1': both(
    'Energy fluctuations through the day',
    'تقلبات في الطاقة خلال اليوم',
  ),
  'dimension.recovery_capacity.low.point.2': both(
    'Slower recovery after stressful periods',
    'بطء التعافي بعد الفترات الضاغطة',
  ),
  'dimension.recovery_capacity.low.point.3': both('Greater risk of burnout', 'خطر أكبر للإنهاك'),
  'dimension.recovery_capacity.low.advice': both(
    'Evaluate sleep and recovery habits alongside neurofeedback.',
    'مراجعة عادات النوم والتعافي إلى جانب الارتجاع العصبي.',
  ),
  'dimension.recovery_capacity.middle.summary': both(
    'Recovery occurs but may be slower than expected after sustained demand.',
    'يحدث التعافي لكنه قد يكون أبطأ من المتوقع بعد الجهد المستمر.',
  ),
  'dimension.recovery_capacity.middle.point.1': both(
    'Residual tiredness after busy periods',
    'تعب متبق بعد الفترات المزدحمة',
  ),
  'dimension.recovery_capacity.middle.point.2': both('Sleep quality varies', 'تفاوت جودة النوم'),
  'dimension.recovery_capacity.middle.point.3': both(
    'Longer wind-down required',
    'الحاجة إلى وقت أطول للاسترخاء',
  ),
  'dimension.recovery_capacity.middle.advice': both(
    'Support recovery through consistent sleep and structured rest.',
    'دعم التعافي من خلال نوم منتظم وراحة منظمة.',
  ),
  'dimension.recovery_capacity.high.summary': both(
    'Recovery between periods of mental and physical effort appears efficient.',
    'يبدو التعافي بين فترات الجهد الذهني والبدني فعالا.',
  ),
  'dimension.recovery_capacity.high.point.1': both(
    'Restorative sleep patterns',
    'أنماط نوم مجددة للنشاط',
  ),
  'dimension.recovery_capacity.high.point.2': both(
    'Quick return to baseline after effort',
    'عودة سريعة إلى المستوى المعتاد بعد الجهد',
  ),
  'dimension.recovery_capacity.high.point.3': both(
    'Good tolerance of demanding periods',
    'تحمل جيد للفترات المتطلبة',
  ),
  'dimension.recovery_capacity.high.advice': both(
    'Protect existing sleep and recovery routines.',
    'الحفاظ على روتين النوم والتعافي الحالي.',
  ),

  'dimension.decision_making.title': both('Decision Making', 'اتخاذ القرارات'),
  'dimension.decision_making.low.summary': both(
    'Decision-making may require greater effort, particularly under load or fatigue.',
    'قد يتطلب اتخاذ القرارات جهدا أكبر، لا سيما تحت العبء أو التعب.',
  ),
  'dimension.decision_making.low.point.1': both(
    'Hesitation on complex choices',
    'تردد في الخيارات المركبة',
  ),
  'dimension.decision_making.low.point.2': both(
    'Reduced clarity when tired',
    'انخفاض الوضوح عند التعب',
  ),
  'dimension.decision_making.low.point.3': both(
    'Greater effort weighing options',
    'جهد أكبر في الموازنة بين الخيارات',
  ),
  'dimension.decision_making.low.advice': both(
    'Use structured planning frameworks to reduce decision load.',
    'استخدام أطر تخطيط منظمة لتقليل عبء اتخاذ القرارات.',
  ),
  'dimension.decision_making.middle.summary': both(
    'Decision-making is generally well supported, though it may vary with cognitive load and fatigue.',
    'اتخاذ القرارات مدعوم جيدا عموما، وقد يتفاوت مع العبء المعرفي والتعب.',
  ),
  'dimension.decision_making.middle.point.1': both(
    'Clarity reduces late in the day',
    'انخفاض الوضوح في أواخر اليوم',
  ),
  'dimension.decision_making.middle.point.2': both(
    'More deliberation needed when busy',
    'الحاجة إلى مزيد من التروي عند الانشغال',
  ),
  'dimension.decision_making.middle.point.3': both(
    'Confidence varies with energy',
    'تفاوت الثقة مع مستوى الطاقة',
  ),
  'dimension.decision_making.middle.advice': both(
    'Use structured planning to support clear decision-making at higher load.',
    'استخدام تخطيط منظم لدعم وضوح القرارات عند ازدياد العبء.',
  ),
  'dimension.decision_making.high.summary': both(
    'Core planning and analytical capabilities appear intact.',
    'تبدو قدرات التخطيط والتحليل الأساسية سليمة.',
  ),
  'dimension.decision_making.high.point.1': both(
    'Ability to assess situations logically',
    'القدرة على تقييم المواقف منطقيا',
  ),
  'dimension.decision_making.high.point.2': both(
    'Strategic thinking remains available',
    'التفكير الاستراتيجي متاح باستمرار',
  ),
  'dimension.decision_making.high.point.3': both(
    'Planning and execution capacity intact',
    'قدرة سليمة على التخطيط والتنفيذ',
  ),
  'dimension.decision_making.high.advice': both(
    'Maintain and reinforce consistent access to these strengths.',
    'الحفاظ على هذه القدرات وتعزيز الوصول المستمر إليها.',
  ),

  // -------------------------------------------------------------------------
  // Recommendations and benefits
  // -------------------------------------------------------------------------
  'recommendation.mental_energy.name': both('Mental Energy', 'الطاقة الذهنية'),
  'recommendation.mental_energy.text': both(
    'Prioritise rest, recovery and energy management.',
    'إعطاء الأولوية للراحة والتعافي وإدارة الطاقة.',
  ),
  'recommendation.attention_focus.name': both('Attention & Focus', 'الانتباه والتركيز'),
  'recommendation.attention_focus.text': both(
    'Reduce distractions and build consistent focus habits.',
    'تقليل المشتتات وبناء عادات تركيز ثابتة.',
  ),
  'recommendation.cognitive_efficiency.name': both('Cognitive Efficiency', 'الكفاءة المعرفية'),
  'recommendation.cognitive_efficiency.text': both(
    'Challenge the brain with varied cognitive activities.',
    'تحفيز الدماغ بأنشطة معرفية متنوعة.',
  ),
  'recommendation.stress_regulation.name': both('Stress Regulation', 'تنظيم التوتر'),
  'recommendation.stress_regulation.text': both(
    'Incorporate daily stress-management techniques.',
    'إدراج أساليب يومية لإدارة التوتر.',
  ),
  'recommendation.recovery_capacity.name': both('Recovery Capacity', 'القدرة على التعافي'),
  'recommendation.recovery_capacity.text': both(
    'Support recovery through good sleep and healthy routines.',
    'دعم التعافي من خلال نوم جيد وروتين يومي سليم.',
  ),
  'recommendation.decision_making.name': both('Decision Making', 'اتخاذ القرارات'),
  'recommendation.decision_making.text': both(
    'Use structured planning to support clear decision-making.',
    'استخدام تخطيط منظم لدعم وضوح اتخاذ القرارات.',
  ),

  'benefit.attention_focus': both('Improved attention & focus', 'تحسن الانتباه والتركيز'),
  'benefit.emotional_regulation': both('Improved emotional regulation', 'تحسن التنظيم الانفعالي'),
  'benefit.stress_management': both('Better stress management', 'إدارة أفضل للتوتر'),
  'benefit.sleep': both('Improved sleep', 'تحسن النوم'),
  'benefit.mental_energy': both('Increased mental energy', 'زيادة الطاقة الذهنية'),
  'benefit.resilience': both('Improved resilience', 'تحسن القدرة على التحمل والتكيف'),
  'benefit.cognitive_endurance': both('Increased cognitive endurance', 'زيادة التحمل المعرفي'),
  'benefit.peak_performance': both('Peak cognitive performance', 'أداء معرفي في أعلى مستوياته'),
  'benefit.recovery': both('Improved recovery', 'تحسن التعافي'),

  // -------------------------------------------------------------------------
  // The programme
  // -------------------------------------------------------------------------
  'sessions.one': both('1 Session', 'جلسة واحدة'),
  'sessions.two': both('2 Sessions', 'جلستان'),
  'sessions.few': both('{count} Sessions', '{count} جلسات'),
  'sessions.many': both('{count} Sessions', '{count} جلسة'),

  'approach.calming.label': first('Calming', 'نهج التهدئة'),
  'approach.calming.text': first(
    'Training will begin with a calming approach to support nervous system regulation, promote relaxation and establish a stable foundation before progressing to more targeted training.',
    'سيبدأ التدريب بنهج التهدئة لدعم تنظيم الجهاز العصبي وتعزيز الاسترخاء وإرساء أساس مستقر قبل الانتقال إلى تدريب أكثر استهدافا.',
  ),
  'approach.stabilising.label': first('Stabilising', 'نهج التثبيت'),
  'approach.stabilising.text': first(
    'Training will begin with a stabilising approach to improve brain regulation and strengthen communication between brain regions before progressing to more targeted training.',
    'سيبدأ التدريب بنهج التثبيت لتحسين تنظيم نشاط الدماغ وتقوية التواصل بين مناطق الدماغ قبل الانتقال إلى تدريب أكثر استهدافا.',
  ),
  'approach.calming_and_stabilising.label': first('Calming & Stabilising', 'نهج التهدئة والتثبيت'),
  'approach.calming_and_stabilising.text': first(
    'Training will begin by combining calming and stabilising approaches to support nervous system regulation while improving communication between brain regions before progressing to more targeted training.',
    'سيبدأ التدريب بالجمع بين نهجي التهدئة والتثبيت لدعم تنظيم الجهاز العصبي وتحسين التواصل بين مناطق الدماغ قبل الانتقال إلى تدريب أكثر استهدافا.',
  ),

  'next.continue_current.label': later('Continue current approach', 'مواصلة النهج الحالي'),
  'next.continue_current.text': later(
    'Training will continue with the current approach, building on the progress made so far.',
    'سيستمر التدريب بالنهج الحالي، بناء على ما تحقق من تقدم حتى الآن.',
  ),
  'next.continue_calming.label': later('Continue calming', 'مواصلة نهج التهدئة'),
  'next.continue_calming.text': later(
    'Training will continue with a calming approach to support nervous system regulation and promote relaxation.',
    'سيستمر التدريب بنهج التهدئة لدعم تنظيم الجهاز العصبي وتعزيز الاسترخاء.',
  ),
  'next.continue_stabilising.label': later('Continue stabilising', 'مواصلة نهج التثبيت'),
  'next.continue_stabilising.text': later(
    'Training will continue with a stabilising approach to improve brain regulation and strengthen communication between brain regions.',
    'سيستمر التدريب بنهج التثبيت لتحسين تنظيم نشاط الدماغ وتقوية التواصل بين مناطق الدماغ.',
  ),
  'next.continue_calming_and_stabilising.label': later(
    'Continue calming & stabilising',
    'مواصلة نهج التهدئة والتثبيت',
  ),
  'next.continue_calming_and_stabilising.text': later(
    'Training will continue by combining calming and stabilising approaches to support nervous system regulation while improving communication between brain regions.',
    'سيستمر التدريب بالجمع بين نهجي التهدئة والتثبيت لدعم تنظيم الجهاز العصبي وتحسين التواصل بين مناطق الدماغ.',
  ),
  'next.progress_to_optimisation.label': later(
    'Progress to optimisation',
    'الانتقال إلى تحسين الأداء',
  ),
  'next.progress_to_optimisation.text': later(
    'Training will progress to optimisation, building on the foundation established so far.',
    'سينتقل التدريب إلى مرحلة تحسين الأداء، بناء على الأساس الذي تحقق حتى الآن.',
  ),
  'next.adjust_focus.label': later(
    'Adjust training focus based on follow-up findings',
    'تعديل محور التدريب بناء على نتائج المتابعة',
  ),
  'next.adjust_focus.text': later(
    'The focus of training will be adjusted in line with the follow-up findings described in this report.',
    'سيعدل محور التدريب بما يتوافق مع نتائج تقييم المتابعة الواردة في هذا التقرير.',
  ),

  // -------------------------------------------------------------------------
  // Brain maps
  // -------------------------------------------------------------------------
  'map.eyes_open': both('EO: Eyes Open', 'العينان مفتوحتان (EO)'),
  'map.eyes_closed': both('EC: Eyes Closed', 'العينان مغلقتان (EC)'),

  // -------------------------------------------------------------------------
  // A follow-up's page of what has changed
  // -------------------------------------------------------------------------
  'tile.sessions_completed': later(
    'Neurofeedback sessions completed',
    'جلسات الارتجاع العصبي المنجزة',
  ),
  'pair.earlier.initial': later('Initial recording', 'التسجيل الأولي'),
  'pair.earlier.previous': later('Previous recording', 'التسجيل السابق'),
  'pair.later': later('Follow-up recording', 'تسجيل المتابعة'),
  'pair.eyes_open': later('eyes open', 'العينان مفتوحتان'),
  'pair.eyes_closed': later('eyes closed', 'العينان مغلقتان'),
  'pair.label': later('{recording}, {eyes}', '{recording}، {eyes}'),
  'pair.not_recorded': later('Not recorded', 'لم يسجل'),

  'table.measure': later('Measure', 'القياس'),
  'table.eyes_open': later('Eyes Open', 'العينان مفتوحتان'),
  'table.eyes_closed': later('Eyes Closed', 'العينان مغلقتان'),
  'measure.with_range': later('{name}, {from}–{to} Hz', '{name}، من {from} إلى {to} هرتز'),
  'measure.delta': later('Delta', 'دلتا'),
  'measure.theta': later('Theta', 'ثيتا'),
  'measure.alpha': later('Alpha', 'ألفا'),
  'measure.alpha_1': later('Alpha 1', 'ألفا 1'),
  'measure.alpha_2': later('Alpha 2', 'ألفا 2'),
  'measure.beta': later('Beta', 'بيتا'),
  'measure.beta_1': later('Beta 1', 'بيتا 1'),
  'measure.beta_2': later('Beta 2', 'بيتا 2'),
  'measure.beta_3': later('Beta 3', 'بيتا 3'),
  'measure.high_beta': later('High Beta', 'بيتا المرتفعة'),

  'figure.about': later('about {value}%', 'نحو {value}%'),
  'figure.about_range': later('about {low}–{high}%', 'نحو {low} إلى {high}%'),
  'figure.none': later('No appreciable change', 'لا تغير يذكر'),
  'figure.lower': later('lower', 'أقل'),
  'figure.higher': later('higher', 'أعلى'),

  /** Which of these is printed follows from where the figures came from. */
  'note.figures.typed': later(
    'The figures on this page are the practitioner’s approximate visual estimates, read from the brain maps shown. They are not calculated from the recording itself and are not a measure of change in brain function.',
    'الأرقام الواردة في هذه الصفحة تقديرات بصرية تقريبية من الممارس، مأخوذة من خرائط الدماغ المعروضة. وهي غير محسوبة من التسجيل نفسه، وليست مقياسا للتغير في وظائف الدماغ.',
  ),
  'note.figures.calculated': later(
    'The figures on this page are calculated from the two recordings named above, as the mapping software measured them.',
    'الأرقام الواردة في هذه الصفحة محسوبة من التسجيلين المذكورين أعلاه، كما قاسهما برنامج رسم الخرائط.',
  ),
  'note.figures.both': later(
    'Some figures on this page are the practitioner’s approximate visual estimates, read from the brain maps shown, and the others are calculated from the two recordings. An estimate is not a measure of change in brain function.',
    'بعض الأرقام الواردة في هذه الصفحة تقديرات بصرية تقريبية من الممارس، مأخوذة من خرائط الدماغ المعروضة، والأخرى محسوبة من التسجيلين. والتقدير ليس مقياسا للتغير في وظائف الدماغ.',
  ),
  'note.earlier_imported': later(
    'The earlier report was written in the practice’s previous report tool.',
    'تمت كتابة التقرير السابق باستخدام أداة التقارير السابقة لدى المركز.',
  ),

  // -------------------------------------------------------------------------
  // The foot of every page
  // -------------------------------------------------------------------------
  'page.of': both('Page {page} of {total}', 'صفحة {page} من {total}'),
  'footer.phone': both('Phone', 'هاتف'),
  'footer.email': both('Email', 'بريد إلكتروني'),
  'footer.website': both('Website', 'الموقع'),
});
