import { ArraySlice } from 'lightning/utilsPrivate';

class MixinBuilder {
    constructor(superclass) {
        this.superclass = superclass;
    }

    // This is a method of the class, not a "with" statement
    with() {
        const mixins = ArraySlice.call(arguments, 0);
        return mixins.reduce((c, mixin) => mixin(c), this.superclass);
    }
}

export default (superclass) => new MixinBuilder(superclass);
