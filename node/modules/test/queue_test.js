var should = require('should');
var sinon = require('sinon');

var logger = require('../logger');
sinon.stub(logger, "info");

var Queue = require('../coderunnerQueue.js');

function DrStub () {
    this.run = function (task, cb) {
        var recFunc = function(){
            if (task.state.solved) {
                cb (null, task.taskResult);
            } else {
                setTimeout(recFunc, 50);
            }
        };
        setTimeout(recFunc, 50);
    };
}

describe ("RunnerQueue tests", function(){
    it("Check number of started & finished tasks", function (done) {
        var queue = new Queue();

        queue.DockerRunner = DrStub;
        queue.maxWorkingTaskNumber = 2;

        var arTasks=[];

        for (var i = 0; i<4; i++){
            var task = {log: logger, session: "__"+i,
                state: {started: false, finished: false, solved: false},
                taskResult: {sessionId: "__"+i, response: i*2}};
            arTasks.push (task);

            queue.push(task, function(err, res) {
                logger.info("task finished!", res);
            });
        }

        arTasks[0].state.should.eql({started: true,  finished: false, solved: false});
        arTasks[1].state.should.eql({started: true,  finished: false, solved: false});
        arTasks[2].state.should.eql({started: false, finished: false, solved: false});
        arTasks[3].state.should.eql({started: false, finished: false, solved: false});

        logger.info("tasks. Stage 1", arTasks);

        arTasks[0].state.solved = true;
        arTasks[1].state.solved = true;

        setTimeout(function(){
            logger.info("tasks. Stage 2", arTasks);

            arTasks[0].state.should.eql({started: true, finished: true, solved: true});
            arTasks[1].state.should.eql({started: true, finished: true, solved: true});
            arTasks[2].state.should.eql({started: true, finished: false, solved: false});
            arTasks[3].state.should.eql({started: true, finished: false, solved: false});

            done();
        }, 300);

    });
});
