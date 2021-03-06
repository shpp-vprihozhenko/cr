CodeRunner service
------------------

### Node.js server

Постоянно работающий сервер, написанный на языке Javascript, запускается интерпритатором Node. Организован как системный сервис (можно использовать пакет forever-service).
Модуль отвечает за прием и обработку REST запросов на тестирование пользовательского кода.

Полученные запросы валидируются сервером и отправляются в сервер архива запросов.

Сервер должен взаимодействать с внешним сервером логирования и рассылки.
Все входящие запросы, все подозрительные секции, найденные в коде, все внутренние системные ошибки должны логироватся на удаленном сервере. Некоторые, особо критичные случаи должны быть отправлены с флагом ```broadcast``` для рассылки почтовых уведомлений администраторам.
Отвалидированный  код отправляется обработчику очереди запуска задач.

Очередь запуска задач представляет собой отдельный модуль на языке Node.js. Делает следующие действия: при поступлении задачи на вход, она проверяет возможность отправки её на менеджер запуска docker контейнеров. В случае, если количество запущенных скриптов превышает заданное конфигурационным файлом значение, очередь оставляет задачу в памяти, ожидая момента, когда поступит комманда на освобождение места в очереди.

Исполнение кода кода пользьзователя происходит в изолированном докер-контейнере с предустановленным компилятором/интерпретатором.
Подготовка и запуск такого контейнера производится менеджером запусков докер-контейнеров, вызываемым из очереди запуска задач.
В докер-контейнере при старте автоматически запускается скрипт, который компилирует и выполняет код пользователя с различными тест-кейсами.

Результаты выполнения тест-кейсов собираются в отдельной папке, создаваемой менеджером запуска докер-контейнеров в процессе подготовки, и по завершении работы докера обрабатываются Анализатором логов.

Анализатор логов проверяет лог-объекты stdout, stderr, поступившие из докер-контейнера и возвращает объект, готовый к отправке обратно пользователю, приславшему на сервер запрос с кодом.



Сервер принимает следующие запросы:
***
**Запрос на проведение тестирования**
```
	Метод : POST
	Путь : /isolated-test
	Тело :
	{
	 "userName": "any name",
	 "serverSecret": "key",
	 "code": ""#include <iostream>\n #include <cstdlib> \nusing namespace std;\n int main() {string greeting;\n cin >> greeting;\n cout << 11111 << greeting << endl;\n return 0;}"",
	 "language": "cpp",
	 "testCases": ["std1","std2"],
	 "optionalConfig": {
			"taskLifetime": 5,
			"maxTestCases": 5,
			"dockerMaxCores": 3,
			"dockerMaxMemory": 512
		}
	}
```
**Формат ответа на запрос**
```
	Код ответа : 200 (запрос принят) / 400 (запрос отклоняется из за переполнения очереди)
	Тело :
	{
		dockerError: "",
		compilerErrors: "",
		stdout : [ "testcase1 otp", "testcase2 otp" ],
		stderr : [ "testcase1 err", "testcase2 err" ],
		timestamps : [ "testcase1 duration", "testcase2 duration" ]
	}
```
***
###Структура взаимодействия между сервером Node и очередью задач.

Добавление задачи в очередь:
```
runnerQueue.push(taskObj,callbackFunc),
```
где ```taskObj``` принимает в качестве входного параметра объект такой структуры:
```
{
	taskId:"",
	code: “”,
	language: “”,
	testCases: [ “stdIn 1”, “stdIn 2” ],
	config: {}
}
```
где ```config``` будет скоректирован опциональными параметрами, которые передал юзер в теле запроса, если они будут в допусимых пределах.
Если в поле ```optionalConfig``` тела запроса не было передано никаких данных, то значения поля```config``` будет null.

 А ```callbackFunc``` возвращает серверу объект такой структуры:
 ```
 {
	dockerError: "",
	compilerErrors: "",
	stdout : [ “testcase1 otp”, “testcase2 otp” ],
	stderr : [ “testcase1 err”, “testcase2 err” ],
	timestamps : [ “testcase1 duration”, “testcase2 duration” ]
}
 ```


###Работа очереди запуска задач

**Запрос на проведение тестирования**
Очередь принимает на вход объект задачи, содержащий следующие свойства:
```
{
	sessionId: "",
	code: "",
	language: "",
	testCases: [ "stdIn 1", "stdIn 2" ],
	config: {}
}
```
и функцию [, callback].

Очередь проверяет привышение лимита параллельно запущенных контейнеров и если лимит привышен - складывает полученный объект в массив.
Если лимит не превышен - очередь передает менеджеру запуска контейнеров полученный объект:
```
{
	sessionId: "",
	code: "",
	language: "",
	testCases: [ "stdIn 1", "stdIn 2" ],
	config: {}
}
```
вместе со своей функицией [, callback].
По [, callback] очередь ожидает от менеджера запуска контейнеров объект с результатом выполнения исходного кода:

```
{
		dockerError: "",
		compilerErrors: "",
		stdout : [ "testcase1 otp", "testcase2 otp" ],
		stderr : [ "testcase1 err", "testcase2 err" ],
		timestamps : [ "testcase1 duration", "testcase2 duration" ]
}
```
и передает этот объект серверу выше.

Объект очереди создаётся следующим образом:
```
var RunnerQueue = require('RunnerQueue');
var runnerQueue = new RunnerQueue();
```
Добавление задачи в очередь - метод push:
```
runnerQueue.push(taskObj,callbackFunc);
```

###Менеджер запуска докер-контейнеров.

Данный модуль получает в качестве входных параметров объект, имеющий следующую структуру:

```
	{
		sessionId 	: "",
		code 		: "",
		language 	: "",
		testCases 	: [ "stdIn 1", "stdIn 2" ],
		config      : {},
		callback 	: function
	}
```

Но основании параметра language он выбирает требуемый для запуска докера образ, формирует структуру папок следующего вида:
* `общая докер-папка / sessionId / input`
* `общая докер-папка / sessionId / output`

В папку input генерирует файл code, тело которого получает входным параметром.

Далее менеджер вызывает команду загрузки докер-контейнера и выполнения стартового bash-скрипта примерно такого вида:

```
var cp = require('child_process');
cp.exec('docker run -d --net none -v имяОбщейПапки: имяОбщейПапки ' + имяКонтейнера + 'start' + sessionId, callbackFunction);
```
Дополнительно требуется найти и прописать параметры, регулирующие количествопамяти для процесса, степень макс. загрузки процессора и т.д.
Колл-бек функция, вызываемая при завершении, должна проверить код завершения работы докера.
Если процесс докера завершился крашем – сформировать объект ответа с сообщением об ошибке.
```
{
   dockerError: "docker crashed",
   compiler errors: "",
   stdout : [ "testcase1 otp", "testcase2 otp" ],
   stderr : [ "testcase1 err", "testcase2 err" ],
   timestamps : [ "testcase1 duration", "testcase2 duration" ]
 }
```
Иначе запустить анализатор логов и сформировать в памяти объект ответа c результатми исполнения тесткейсов.
Сразу после старта процесса с докером требуется запустить отложенную на № секунд (из конф-файла) функцию, которая должна проверить, завершился ли уже процесс докера. Если да – то ок, пишем в лог и выходим, если нет – отдаём команду kill процессу докера и тоже пишем в лог. Объект ответа в этом случае содержит информацию только о том, что процесс превысил допустимое время выполнения:
```
 {
   dockerError: "docker killed"
   compiler errors: "",
   stdout : [ "testcase1 otp", "testcase2 otp" ],
   stderr : [ "testcase1 err", "testcase2 err" ],
   timestamps: [ "testcase1 duration", "testcase2 duration" ]
 }
```
Перед завершением работы менеджера - удалить временные каталоги и файлы по следующим путям: общая докер-папка / sessionId / input общая докер-папка / sessionId /output
По завершении вызываем колл-бек функцию callback, полученную во вxодных параметрах, и передаём ей sessionId завершённой задачи и сформированный объект ответа:
```callback(sessionId, объект_ответа);```

Объект менеджера создаётся следующим образом:
```
var CodeRunner = require('RunnerQueue');
var codeRunner = new CodeRunner();
```
Передача задачи менеджеру - метод run:
```
codeRunner.run(taskObj,callbackFunc);
```

### TestCasesRunner module

Данный модуль отвечает за запуск уже скопилированного кода с нашими тест-кейсами.

API:
```
public constructor(sessionId)
public setTestCases(testCases:Array)
public run(callback)
```

Метод `setTestCases` принимает нужные тест-кейсы и сохраняет их в себе.
Метод `run` принимает callback и запускает тест-кейсы по очереди через `DockerExecutor.runTestCase`

### DockerExecutor

DockerExecutor должен запускать команды докера на компиляцию, запуск тест кейса, убивать контейнер по таймауту и ничего больше(!).

DockerExecutor должен иметь следующие методы public методы:
```
public constructor(sessionId, imageName)
public startCompile(callback)
public runTestCase(testCase, callback)
```

В конструкторе мы получаем sessionId (что бы знать, с какой папкой работать) и imageName (что бы знать, какой образ запускать).

Метод *startCompile* должен просто запускать startcompile bash'ник.

Метод *runTestCase* должен запускать start bash-скрипт и передавать на stdin содержимое тест-кейса.

Все запросы к докеру должны быть сохранены внутри самого DockerExecutor в виде строки как темплейт для будущих запросов
Example:
```
this.commandTemplates.startCompule = 'docker run --name={sessionId} -m={dockerMaxQuery} -v {sharedDir}:/opt/data'
```

После чего перед выполнением данный темлпейт обрабатывается через `str_replace` и подставляет нужные параметры для запроса.

DockerExecutor должен иметь встроенный дефолтный this.timeout в котором будет хранится время в миллисекундах, после которого контейнер должен убиться, если таска не закончила свою работу по истечению времени таймаута.

### TestCaseRunner

###Докер-контейнер

Каждый процесс компиляции или выполнения отдельного тест-кейса стартует в отдельном контейнере.
Для обратной связи с хостом используются стандартные потоки ввода-вывода.

Контейнеры для всех языков хранятся в директории `./docker`. Для каждого отдельноко контейнера отведен каталог. К примеру, докер-контейнер для работы с С++ кодом должен находится в директории `./docker/cpp/`

Если запущен процесс компиляции -- контейнер компилирует файл `sessionId/input/code` и помещает скомпилированный файл в директорию `sessionId/compiled`. Процесс компиляции логируется в файле  в папке output с именем logCompile.

В случае запуска выполнения тест-кейса, производится запуск откомпилированного файла из директории `sessionId/compiled` с передачей ему через stdin конкретного тест-кейса. Результат работы тесткейса сохраняется в файле `output/testCaseLog`. Ошибки времени исполнения логируются в файл `output/testCaseErr`.

Дополнительно докер-контейнер должен контролировать обьем выгруженных в std-out данных, что бы исключить переполнение.


###Завершающий этап обработки текущей задачи

При вызове функции колл-бека из менеджера запусков докер-контейнеров, отправляется комманда очереди на освобождение одногом места и передаётся серверу ноды объект с результатами запуска кода клиента, после чего проивзодим отправку на исходный response.

###Анализатор логов
Вызывется из менеджера докер-контейнеров после завершения всех тест-кейсо.
Производит анализ результатов работы программы пользвателя, проверяя объекты stdout и stderr на несанкционированную информацию о докер-контейнере, и формирует на выходе объект:
```
	{
		dockerError : "",
		compilerErrors : "",
		stdout : [ "testcase1 otp", "testcase2 otp" ],
		stderr : [ "testcase1 err", "testcase2 err" ],
		timestamps : [ "testcase1 duration", "testcase2 duration" ]
	}
```
Файл logCompile содержит описание процесса компиляции

###Конфиг-файл сервера

```
	{
		taskQueueLimit 		: 1,
		paralellTasks 		: 1,
		dockerLifetime 		: 5,
		dockerLogsLimit		: 1500,
		setverSecret 		: "someSecretPassword",
		dockerDir			: "./docker",
		docketSharedDir 	: "./docker/shared",
		requestAnaliticsTime: 60000,
		supportedLangs		: [
			"cpp",
			"java",
			"js"
		],
		quotes : {
			tasksPerMinute	: 10,
			rageCoeficient	: 1.5,
			patience		: 2,
			codeLength		: 1500,
			dockerMaxCores	: 1,
			dockerMaxMemory	: 512
		},
		alarmObservers	: [
			"mail@example.com",
			"somemail@domain.net"
		]
	}
```


###Анализатор частоты запросов (rejecter.js)

Для каждого пользователя, при первом его запросе на сервер создается лог частоты запросов.
Для уменьшения затрат памяти, для каждого пользователя хранится информация только о последних запросах (время определяется параметром `requestAnaliticsTime`).
Основная задача анализатора частоты -- дать ответ позволено ли пользователю выполнять на сервере запрос в соответствии с системными квотами.

Запрос на анализ частоты производится статическим методом `isRequestAllowed(userid);`.
Метод возвращает `true` если запрос не превышает квоту и `false` если квота пользователя на запросы превышена.

Квота на запросы не статична. Допускаются редкие пики запросов, но при этом они не должны быть длительными, и не должны превышать квоту боьлше чем в `rageCoeficient` раз. Реализивать такое поведение нужно при помощи функции вычисления терпимости сервера.

Параметр `patience` определяет сколько секунд сервер будет "тепреть" чрезмерную активность пользователя с частотой запросов в пределах от `tasksPerMinute` до `tasksPerMinute * rageCoeficient`.


###Общее положение

Сервер должен ограничивать количество запросов на компиляцию для каждого пользователя.
Запросы принимаются исключительно от доверенных серверов. Остальные -- игнорируются.

После приема и подтверждения запроса выполняются следующие действия:
- Генерирование случайного идентификатора ```sessionId``` для сессии тестирования.
- Санитаризация входящего кода.
- Подготовка общей директории для виртуальной машины и хоста ```~/.coderunner/sessionId```.
- Создание в директории ```~/.coderunner/sessionId/input``` файлов ```source.x``` с исходным кодом, где x - соотествующее языку програмирования расширение и ```testcases```, который стостоит из строк входных данных для последоватлеьного тестирования.


### Модуль санитаризации кода

Клас со статическим методом, который принимает параметром объект с кодом и маркер языка.

```
	{
		code: "",
		language: ""
	}
```
Результат работы модуля -- список обнаруженных нарушений в коде в виде массива:
```
[
	{
		line: 0, 			(номер линии с нарушением)
		danger-level: 0, 	(уровень опасности, чем выше -- тем хуже)
		text: "",			(строка с нарушением)
		comment: ""			(описание обнаруженного нарушения)
	}, ... {}
]
```
После анализа кода модуль, в случае обнаружения угроз, будет возвращать объект слудующего содержания:
```
{
    validity: false,
    log : [{...}]
}
```

и объект:
```
{
    validity: true,
    log : null
}
```
если угроз не обнаружено.

### Сервер логирования

Сервер отвечает за логирование (записать в базу) входящих сообщений.
Основное предназначение -- логирование запросов к серверу CodeRunner. Запрос на логирование отправляется по адресу ```logserverhost/logme.php``` и должен содержать поле ```secret``` в котором хранится секретный ключ. Без ключа сервер отвечает на запрос ошибкой с кодом 403. Просмотреть данные логирования можно в корне домена сервера. Для входа в систему нужно ввести секретный ключ администратора. Секретные ключи хранятся в файле ```config.php```.

Сервер принимает запросы:

***
**Запрос на логирование**
```
	Метод : POST
	Путь : /logme.php
	Тело : {
		secret : "someSecret",
		......
		any json data
	}
```
**Формат ответа на запрос**
```
	Код ответа : 200 / 403
```
***

### install.sh

Скрипт развертки приложения CodeRunner.
Скрипт должен удостоверить наличие на сервере необходимых пакетов (```which```), и в случае их отсутствия: установить.
Необходимые пакеты: node, npm, forever, forever-service, остальные модули, curl, docker, файлы node сервера (храним на GitHub), образы Docker контейнеров.

### Внутренние Bash скрипты для Docker-контейнеров
Имя скрипта - ``start``, расположен в корневой папке контейнера.
В качестве первого параметра данный скрипт получает sessionId исполняемого объекта, который одновременно является и именем папки с исходным кодом и файлом с тест-кейсами.
Скрипт должен обеспечивать компиляцию кода из файла sessionID/input/code и исполнение его.
Результат компиляции должен логироваться в файле logCompile.
Результат выполнения и ошибки поступают в стандартные потоки ввода-вывода и в поток ошибок соответственно.

### Примеры запросов:
Тип - POST , header content-type - application-json .
Тело:
 ```
 {
 "userName": "any name",
 "serverSecret": "key",
 "code": "#include <iostream>\n #include <cstdlib> \nusing namespace std;\n int main() {string greeting;\n cin >> greeting;\n cout << 11111 << greeting << endl;\n return 0;}",
 "language":"cpp",
 "testCases":["std1","std2"],
 "optionalConfig": {
        "taskLifetime": 5,
        "maxTestCases": 5,
        "dockerMaxCores": 3,
        "dockerMaxMemory": 512
    }
 }

 ```
 Не забываем слать запросы на правильный порт и путь:
 ```
 http://localhost:5555/isolated-test
 ```

##Пример запроса курлом
```
  curl -H "Content-Type: application/json" -X POST -d '{"userName": "any name","serverSecret": "key","code": "#include <iostream>\n #include <cstdlib> \nusing namespace std;\n int main() {string greeting;\n cin >> greeting;\n cout << 11111 << greeting << endl;\n return 0;}","language":"cpp","testCases":["std1","std2"],"optionalConfig": {"taskLifetime": 5,"maxTestCases": 5,"dockerMaxCores": 3,"dockerMaxMemory": 512}}' http://localhost:5555/isolated-test
```
