# قايمة القديسين الثابتة لـ«خبزنا اليومي» — اقتراح للموافقة (2026-11-19)

القايمة دي هتتحفظ في الريبو مرة واحدة (`daily-bread/saints/registry.json` + الصور في `assets/img/saints/`). كل شهر الكود بياخد منها أعياد الشهر، من غير بحث جديد. كلمة السنكسار القصيرة لسه بتيجي من صفحة القطمارس في الأنبا تكلا، ومعاها رابطها.

## ملخص سريع

- **٦٥ اسم** في ٧ مجموعات (العدد تحت).
- كل تاريخ ليه مصدر. اللي مش متأكد منه مكتوب جنبه ❓ ومش هيدخل الملف غير لما ترد.
- **الصور والتماجيد:** لسه لكل الـ٦٥. بعد ما توافق على القايمة بدوّر لكل اسم على صورة حلوة وحديثة (زي اللي بعتها للعدرا) وتمجيده، وبعملك ورقة فيها كل الصور جنب بعض تشوفها بعينك. لقيت تماجيد جاهزة في الأنبا تكلا لـ: أبي سيفين، مار جرجس، العدرا، الأنبا باخوم، الأنبا موسى، الأنبا بولا، الأمير تادرس، أبونا بيشوي كامل، أبونا عبد المسيح المناهري.

## حاجات لازم تعرفها

- **الأنبا ثاؤفيلس اتنيح** يوم ١٣ فبراير ٢٠١٩. هو كان أول أسقف للبحر الأحمر (من ١٩٩٢). علشان كده دخل بيوم نياحته، مش جلوسه.
- **أسقف البحر الأحمر دلوقتي الأنبا إيلاريون.** ده الوحيد من الأساقفة الأحياء في القايمة، مع البابا تواضروس.
- **الأنبا باخوميوس مطران البحيرة اتنيح** يوم ٣٠ مارس ٢٠٢٥. داخل بيوم نياحته.
- **«الأنبا مكاريوس أسقف قنا»:** لقيته. أسقف قنا من ١٩٦٥، وكانت إيبارشيته فيها قنا والبحر الأحمر. اتنيح وهو بيصلي القداس يوم ٣ فبراير ١٩٩١ (٢٦ طوبة). **مالقتش إنه كان أسقف أسوان.** لو تقصد حد تاني قولّي.

## اتبحث إزاي

1. **السنكسار كله:** نزّلت سنكسار الأنبا تكلا لكل يوم في السنة القبطية (٣٦٦ يوم)، ودوّرت فيه على كل اسم. أي قديس تاريخه من هناك ليه رابط صفحة يومه.
2. **الأساقفة:** دليل الآباء الأساقفة في الأنبا تكلا (٢٨٢ أسقف، حرف حرف)، ومنه سيرة كل أسقف اخترته (تاريخ رسامته ونياحته).
3. **البابوات:** نفس الموقع، صفحة كل بابا.
4. **الآباء المعاصرين:** قرارات المجمع المقدس بالاعتراف بالقداسة (بيشوي كامل ويسطس الأنطوني؛ ميخائيل إبراهيم في مايو ٢٠٢٦)، وأشهر الآباء المتنيحين عند الشباب.
5. **التحويل للميلادي:** بالكود (`tools/lib/coptic.mjs`)، مش بالإيد. اتجرب على تواريخ معروفة: ٢٩ كيهك = ٧ يناير، جلوس البابا شنودة ٤ هاتور ١٦٨٨ = ١٤ نوفمبر ١٩٧١، نياحة البابا كيرلس ٣٠ أمشير = ٩ مارس.

## اللي سبته عن قصد

- **باقي الأساقفة الأحياء** (أكتر من ١٠٠): كتير جدًا، ومش معروفين للشباب كلهم. ممكن نضيف حد بعينه بعدين (شوف تحت).
- **قديسين السنكسار القليلين الشهرة** (السنكسار فيه أكتر من ١٠٠٠ اسم): اخترت اللي الشباب يعرفهم وليهم كنايس.
- **الأنبا صرابامون اللي اعترف بيه المجمع ٢٠٢٦:** الخبر بيقول «مطران الخرطوم المتنيح ١٩٩٥»، وفي الأنبا تكلا اتنين بالاسم ده بتواريخ مختلفة. مش واضح مين، فسبته.
- **التذكار الشهري** (٢١ للعدرا و١٢ لميخائيل كل شهر): هيبقى عيد كل شهر، فسبته. الأعياد الكبيرة بس.
- **الأعياد السيدية** (الميلاد والغطاس والقيامة…): القايمة دي للأشخاص بس.

## لما يومين يقعوا على نفس اليوم

مثلًا ١٧ مارس: نياحة البابا شنودة وأبونا فلتاؤس. والأنبا بيشوي والأنبا كاراس الاتنين ٨ أبيب. الكارت بيوري عيد واحد في اليوم. **اقتراحي:** الترتيب حسب ترتيب القايمة (العدرا والملائكة، ثم الرسل، ثم الشهداء…)، والأدمن يقدر يغيّر في تبويب «الأعياد».

## إزاي تضيف حد بعدين من غير AI

- الملف `daily-bread/saints/registry.json`: كل شخص سطر فيه الاسم، والأيام (اليوم + الشهر القبطي + النوع + رابط المصدر)، والصورة ومصدرها، والتمجيد ومصدره.
- بتضيف الشخص، وبتشغّل `cd tools && npm run saints-check`. ده بيتأكد إن الملف سليم، وإن كل يوم ليه مصدر، وإن الصورة موجودة، وبيطلع ورقة فيها كل الصور جنب بعض.
- لو حابب تضيف من الأدمن نفسه (من غير ملفات)، ده ممكن يتعمل بعدين كخطوة لوحدها.

## أسئلة ليك

- **الحاجات الحديثة بالقبطي ولا بالميلادي؟** جلوس البابا تواضروس ١٨ نوفمبر = ٩ هاتور. بس كل ٤ سنين التاريخ القبطي بيقع يوم بعده (١٩ نوفمبر ٢٠٢٧). الكنيسة بتحتفل ١٨ نوفمبر. **اقتراحي:** القديسين القدامى بالقبطي (زي السنكسار)، والأحداث الحديثة اللي مش في السنكسار (جلوس، نياحة بعد ١٩٠٠) باليوم الميلادي. الملف بيقبل الاتنين.
- **شهداء ليبيا الـ٢١:** مش موجودين في سنكسار الأنبا تكلا. التاريخ ١٥ فبراير ٢٠١٥ = ٨ أمشير. محتاج مصدر رسمي لإضافتهم للسنكسار
- **الأنبا إيلاريون أسقف البحر الأحمر — أسقفنا، ربنا يحافظ عليه:** الأنبا تكلا: رسامته ٩ يونيو ٢٠١٩. الأهرام: التجليس في الغردقة ٢٧ يوليو ٢٠١٩. الإيبارشية بتحتفل بأنهي يوم؟
- **القديس أبونا عبد المسيح المناهري:** مصدر: صفحة «السنكسار اليومي» على فيسبوك (٦ برمودة). محتاج تأكيد من مصدر تاني
- **القديس القمص ميخائيل إبراهيم:** المجمع اعترف بيه ٢٢ مايو ٢٠٢٦ (أخبار اليوم). يوم النياحة لسه ملقتلوش مصدر
- **أبونا أندراوس الصموئيلي:** مصدر واحد بس (دار أنطون). محتاج تأكيد
- **القديس الأرشيدياكون حبيب جرجس:** التاريخ من الذاكرة. لسه بدوّر على مصدر

## القايمة

**العدد:** السيدة العذراء والملائكة والسابق ٤ · الرسل ٣ · الشهداء ١٤ · الآباء النساك والرهبان القدامى ١٥ · البابوات ٨ · الآباء الأساقفة والمطارنة ١٤ · الآباء الكهنة والرهبان المعاصرين ٧ · **المجموع ٦٥**

### السيدة العذراء والملائكة والسابق (٤)

| | الاسم | الأيام (قبطي ← ميلادي السنة دي) | المصدر |
| --- | --- | --- | --- |
| ١ | السيدة العذراء مريم | ميلادها: ١ بشنس ← ٩ مايو<br>دخولها الهيكل: ٣ كيهك ← ١٢ ديسمبر<br>نياحتها: ٢١ طوبه ← ٢٩ يناير<br>تجليها بالزيتون: ٢٤ برمهات ← ٢ أبريل<br>صعود جسدها: ١٦ مسرى ← ٢٢ أغسطس<br>مجيء العائلة المقدسة لمصر: ٢٤ بشنس ← ١ يونيو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=9&imonth=5&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=12&imonth=12&iyear=2026&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=29&imonth=1&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=2&imonth=4&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=22&imonth=8&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=1&imonth=6&iyear=2027&dbl=ar) |
| ٢ | رئيس الملائكة ميخائيل | عيده: ١٢ هاتور ← ٢١ نوفمبر<br>عيده: ١٢ بؤونه ← ١٩ يونيو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=21&imonth=11&iyear=2026&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=19&imonth=6&iyear=2027&dbl=ar) |
| ٣ | رئيس الملائكة غبريال | تذكاره: ٢٢ كيهك ← ٣١ ديسمبر<br>تذكاره: ١٣ بؤونه ← ٢٠ يونيو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=31&imonth=12&iyear=2026&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=20&imonth=6&iyear=2027&dbl=ar) |
| ٤ | القديس يوحنا المعمدان | استشهاده: ٢ توت ← ١٢ سبتمبر<br>ميلاده: ٣٠ بؤونه ← ٧ يوليو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=12&imonth=9&iyear=2026&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=7&imonth=7&iyear=2027&dbl=ar) |

### الرسل (٣)

| | الاسم | الأيام (قبطي ← ميلادي السنة دي) | المصدر |
| --- | --- | --- | --- |
| ١ | مار مرقس الرسول | استشهاده: ٣٠ برموده ← ٨ مايو<br>ظهور رأسه: ٣٠ بابه ← ٩ نوفمبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=8&imonth=5&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=9&imonth=11&iyear=2026&dbl=ar) |
| ٢ | الرسولان بطرس وبولس | استشهادهما: ٥ أبيب ← ١٢ يوليو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=12&imonth=7&iyear=2027&dbl=ar) |
| ٣ | القديس استفانوس أول الشهداء | استشهاده: ١ طوبه ← ٩ يناير | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=9&imonth=1&iyear=2027&dbl=ar) |

### الشهداء (١٤)

| | الاسم | الأيام (قبطي ← ميلادي السنة دي) | المصدر |
| --- | --- | --- | --- |
| ١ | الشهيد العظيم أبي سيفين (فيلوباتير مرقوريوس) — شفيع كنيستنا | استشهاده: ٢٥ هاتور ← ٤ ديسمبر<br>تكريس كنيسته: ٢٥ أبيب ← ١ أغسطس<br>نقل أعضائه: ٩ بؤونه ← ١٦ يونيو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=4&imonth=12&iyear=2026&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=1&imonth=8&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=16&imonth=6&iyear=2027&dbl=ar) |
| ٢ | الشهيد العظيم مار جرجس | استشهاده: ٢٣ برموده ← ١ مايو<br>تكريس كنيسته: ٧ هاتور ← ١٦ نوفمبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=1&imonth=5&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=16&imonth=11&iyear=2026&dbl=ar) |
| ٣ | الشهيد مار مينا العجايبي | استشهاده: ١٥ هاتور ← ٢٤ نوفمبر<br>تكريس كنيسته بمريوط: ١٥ بؤونه ← ٢٢ يونيو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=24&imonth=11&iyear=2026&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=22&imonth=6&iyear=2027&dbl=ar) |
| ٤ | الأمير تادرس الشطبي | استشهاده: ٢٠ أبيب ← ٢٧ يوليو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=27&imonth=7&iyear=2027&dbl=ar) |
| ٥ | الشهيد مار بقطر بن رومانيوس | استشهاده: ٢٧ بؤونه ← ٤ يوليو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=4&imonth=7&iyear=2027&dbl=ar) |
| ٦ | الشهيدان أباكير ويوحنا | استشهادهما: ١٤ بؤونه ← ٢١ يونيو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=21&imonth=6&iyear=2027&dbl=ar) |
| ٧ | الشهيد أبانوب النهيسي | استشهاده: ٢٤ أبيب ← ٣١ يوليو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=31&imonth=7&iyear=2027&dbl=ar) |
| ٨ | الشهيدان سرجيوس وواخس | استشهاد سرجيوس: ١٠ بابه ← ٢٠ أكتوبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=20&imonth=10&iyear=2026&dbl=ar) |
| ٩ | الشهيد يعقوب المقطع | تذكاره: ٣٠ برمهات ← ٨ أبريل | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=8&imonth=4&iyear=2027&dbl=ar) |
| ١٠ | الشهيدة دميانة | استشهادها: ١٣ طوبه ← ٢١ يناير<br>تكريس كنيستها: ١٢ بشنس ← ٢٠ مايو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=21&imonth=1&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=20&imonth=5&iyear=2027&dbl=ar) |
| ١١ | الشهيدة مارينا | استشهادها: ٢٣ أبيب ← ٣٠ يوليو<br>تكريس كنيستها: ٢٣ هاتور ← ٢ ديسمبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=30&imonth=7&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=2&imonth=12&iyear=2026&dbl=ar) |
| ١٢ | الشهيدة بربارة | استشهادها: ٨ كيهك ← ١٧ ديسمبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=17&imonth=12&iyear=2026&dbl=ar) |
| ١٣ | الشهيدة رفقة وأولادها الخمسة | استشهادهم: ٧ توت ← ١٧ سبتمبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=17&imonth=9&iyear=2026&dbl=ar) |
| ١٤ | شهداء ليبيا الـ٢١ | استشهادهم: ٨ أمشير ← ١٥ فبراير | ❓ |

### الآباء النساك والرهبان القدامى (١٥)

| | الاسم | الأيام (قبطي ← ميلادي السنة دي) | المصدر |
| --- | --- | --- | --- |
| ١ | القديس الأنبا أنطونيوس | نياحته: ٢٢ طوبه ← ٣٠ يناير | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=30&imonth=1&iyear=2027&dbl=ar) |
| ٢ | القديس الأنبا بولا أول السواح | نياحته: ٢ أمشير ← ٩ فبراير | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=9&imonth=2&iyear=2027&dbl=ar) |
| ٣ | القديس الأنبا مقار الكبير | نياحته: ٢٧ برمهات ← ٥ أبريل | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=5&imonth=4&iyear=2027&dbl=ar) |
| ٤ | القديس الأنبا بيشوي | نياحته: ٨ أبيب ← ١٥ يوليو<br>نقل جسده: ٤ كيهك ← ١٣ ديسمبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=15&imonth=7&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=13&imonth=12&iyear=2026&dbl=ar) |
| ٥ | القديس الأنبا موسى الأسود | استشهاده: ٢٤ بؤونه ← ١ يوليو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=1&imonth=7&iyear=2027&dbl=ar) |
| ٦ | القديس الأنبا يحنس القصير | نياحته: ٢٠ بابه ← ٣٠ أكتوبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=30&imonth=10&iyear=2026&dbl=ar) |
| ٧ | القديسان مكسيموس ودوماديوس | نياحة مكسيموس: ١٤ طوبه ← ٢٢ يناير<br>نياحة دوماديوس: ١٧ طوبه ← ٢٥ يناير | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=22&imonth=1&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=25&imonth=1&iyear=2027&dbl=ar) |
| ٨ | القديس الأنبا باخوميوس أب الشركة | نياحته: ١٤ بشنس ← ٢٢ مايو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=22&imonth=5&iyear=2027&dbl=ar) |
| ٩ | القديس الأنبا شنودة رئيس المتوحدين | نياحته: ٧ أبيب ← ١٤ يوليو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=14&imonth=7&iyear=2027&dbl=ar) |
| ١٠ | القديس الأنبا كاراس السائح | نياحته: ٨ أبيب ← ١٥ يوليو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=15&imonth=7&iyear=2027&dbl=ar) |
| ١١ | القديس الأنبا صموئيل المعترف | نياحته: ٨ كيهك ← ١٧ ديسمبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=17&imonth=12&iyear=2026&dbl=ar) |
| ١٢ | القديس الأنبا تكلا هيمانوت | نياحته: ٢٤ مسرى ← ٣٠ أغسطس | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=30&imonth=8&iyear=2027&dbl=ar) |
| ١٣ | القديس الأنبا برسوم العريان | نياحته: ٥ النسيء ← ١٠ سبتمبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=10&imonth=9&iyear=2027&dbl=ar) |
| ١٤ | القديس الأنبا رويس | نياحته: ٢١ بابه ← ٣١ أكتوبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=31&imonth=10&iyear=2026&dbl=ar) |
| ١٥ | القديسة مريم المصرية | نياحتها: ٦ برموده ← ١٤ أبريل | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=14&imonth=4&iyear=2027&dbl=ar) |

### البابوات (٨)

| | الاسم | الأيام (قبطي ← ميلادي السنة دي) | المصدر |
| --- | --- | --- | --- |
| ١ | القديس البابا أثناسيوس الرسولي (٢٠) — شفيع الأسرة | نياحته: ٧ بشنس ← ١٥ مايو<br>تذكار معجزته: ٣٠ توت ← ١٠ أكتوبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=15&imonth=5&iyear=2027&dbl=ar) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=10&imonth=10&iyear=2026&dbl=ar) |
| ٢ | القديس البابا بطرس خاتم الشهداء (١٧) | استشهاده: ٢٩ هاتور ← ٨ ديسمبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=8&imonth=12&iyear=2026&dbl=ar) |
| ٣ | القديس البابا كيرلس عمود الدين (٢٤) | نياحته: ٣ أبيب ← ١٠ يوليو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=10&imonth=7&iyear=2027&dbl=ar) |
| ٤ | القديس البابا ديسقورس (٢٥) | نياحته: ٧ توت ← ١٧ سبتمبر | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=17&imonth=9&iyear=2026&dbl=ar) |
| ٥ | البابا كيرلس الرابع أبو الإصلاح (١١٠) | نياحته: ٢٣ طوبه ← ٣١ يناير | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=31&imonth=1&iyear=2027&dbl=ar) |
| ٦ | القديس البابا كيرلس السادس (١١٦) | نياحته: ٣٠ أمشير ← ٩ مارس | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=9&imonth=3&iyear=2027&dbl=ar) |
| ٧ | البابا شنودة الثالث (١١٧) | نياحته (١٧ مارس ٢٠١٢): ٨ برمهات ← ١٧ مارس<br>عيد جلوسه: ٥ هاتور ← ١٤ نوفمبر | [الصفحة](https://st-takla.org/Saints/popes/118/pope-tawadrous-ii.html) [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=14&imonth=11&iyear=2026&dbl=ar) |
| ٨ | البابا تواضروس الثاني (١١٨) — ربنا يحافظ عليه | عيد جلوسه (١٨ نوفمبر ٢٠١٢): ٩ هاتور ← ١٨ نوفمبر | [الصفحة](https://st-takla.org/Saints/popes/118/pope-tawadrous-ii.html) |

### الآباء الأساقفة والمطارنة (١٤)

| | الاسم | الأيام (قبطي ← ميلادي السنة دي) | المصدر |
| --- | --- | --- | --- |
| ١ | القديس الأنبا إبرآم أسقف الفيوم | نياحته: ٣ بؤونه ← ١٠ يونيو | [السنكسار](https://st-takla.org/zJ/index.php/ar-readings-katamares?view=synaxarium-arabic&iday=10&imonth=6&iyear=2027&dbl=ar) |
| ٢ | الأنبا ثاؤفيلس أول أسقف للبحر الأحمر | نياحته (١٣ فبراير ٢٠١٩): ٦ أمشير ← ١٣ فبراير | [الصفحة](https://st-takla.org/Saints/bishops/thaa/theophilos-redsea.html) |
| ٣ | الأنبا إيلاريون أسقف البحر الأحمر — أسقفنا، ربنا يحافظ عليه | عيد رسامته/جلوسه: ؟ | ❓ |
| ٤ | القديس الأنبا مكاريوس أسقف قنا | نياحته (٣ فبراير ١٩٩١): ٢٦ طوبه ← ٣ فبراير | [الصفحة](https://st-takla.org/Saints/bishops/meem/makarius-quena.html) |
| ٥ | الأنبا باخوميوس مطران البحيرة | نياحته (٣٠ مارس ٢٠٢٥): ٢١ برمهات ← ٣٠ مارس | [الصفحة](https://st-takla.org/Saints/bishops/baa/bakhomios-beheira.html) |
| ٦ | الأنبا بيشوي مطران دمياط | نياحته (٣ أكتوبر ٢٠١٨): ٢٣ توت ← ٣ أكتوبر | [الصفحة](https://st-takla.org/Saints/bishops/baa/bishoy-demyat.html) |
| ٧ | الأنبا صموئيل أسقف الخدمات | نياحته (٦ أكتوبر ١٩٨١): ٢٦ توت ← ٦ أكتوبر | [الصفحة](https://st-takla.org/Saints/bishops/saad/samoil-services.html) |
| ٨ | الأنبا غريغوريوس أسقف البحث العلمي | نياحته (٢٢ أكتوبر ٢٠٠١): ١٢ بابه ← ٢٢ أكتوبر | [الصفحة](https://st-takla.org/Saints/bishops/ghain/ghrighorios-research.html) |
| ٩ | الأنبا بيمن أسقف ملوي | نياحته (١٩ مايو ١٩٨٦): ١١ بشنس ← ١٩ مايو | [الصفحة](https://st-takla.org/Saints/bishops/baa/bimen-mallawy.html) |
| ١٠ | الأنبا ميخائيل مطران أسيوط | نياحته (٢٣ نوفمبر ٢٠١٤): ١٤ هاتور ← ٢٣ نوفمبر | [الصفحة](https://st-takla.org/Saints/bishops/meem/mikhail-assiut.html) |
| ١١ | الأنبا إبيفانيوس أسقف دير أبو مقار | نياحته (٢٩ يوليو ٢٠١٨): ٢٢ أبيب ← ٢٩ يوليو | [الصفحة](https://st-takla.org/Saints/bishops/alif/abifanios-makar.html) |
| ١٢ | الأنبا أثناسيوس مطران بني سويف | نياحته (١٦ نوفمبر ٢٠٠٠): ٧ هاتور ← ١٦ نوفمبر | [الصفحة](https://st-takla.org/Saints/bishops/alif/athnasius-banysweif.html) |
| ١٣ | الأنبا يوأنس أسقف الغربية | نياحته (٤ نوفمبر ١٩٨٧): ٢٤ بابه ← ٣ نوفمبر | [الصفحة](https://st-takla.org/Saints/bishops/yaa/youannes-gharbia.html) |
| ١٤ | الأنبا كاراس أسقف المحلة | نياحته (١٣ أكتوبر ٢٠٢١): ٣ بابه ← ١٣ أكتوبر | [الصفحة](https://st-takla.org/Saints/bishops/kef/karas-mahalla.html) |

### الآباء الكهنة والرهبان المعاصرين (٧)

| | الاسم | الأيام (قبطي ← ميلادي السنة دي) | المصدر |
| --- | --- | --- | --- |
| ١ | القديس القمص بيشوي كامل | نياحته (٢١ مارس ١٩٧٩): ١٢ برمهات ← ٢١ مارس | [الصفحة](https://st-takla.org/lyrics/en/glorifications/p/pishoy-kamel.html) |
| ٢ | القديس أبونا يسطس الأنطوني | نياحته (١٧ ديسمبر ١٩٧٦): ٨ كيهك ← ١٧ ديسمبر | [الصفحة](https://st-takla.org/Saints/Coptic-Orthodox-Saints-Biography/Coptic-Saints-Story_1915.html) |
| ٣ | القديس أبونا عبد المسيح المناهري | نياحته (١٤ أبريل ١٩٦٣): ٦ برموده ← ١٤ أبريل | ❓ |
| ٤ | القديس القمص ميخائيل إبراهيم | نياحته: ؟ | ❓ |
| ٥ | أبونا فلتاؤس السرياني | نياحته (١٧ مارس ٢٠١٠): ٨ برمهات ← ١٧ مارس | [الصفحة](https://www.albawabhnews.com/2998309) |
| ٦ | أبونا أندراوس الصموئيلي | نياحته (٧ فبراير ١٩٨٩؟): ٣٠ طوبه ← ٧ فبراير | ❓ |
| ٧ | القديس الأرشيدياكون حبيب جرجس | نياحته (٢١ أغسطس ١٩٥١): ١٥ مسرى ← ٢١ أغسطس | ❓ |


